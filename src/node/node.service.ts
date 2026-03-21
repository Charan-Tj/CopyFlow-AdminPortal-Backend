import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { R2Service } from '../r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { createClient } from '@supabase/supabase-js';
import { deriveRuntimeStatus, evaluateKioskStatus } from './kiosk-status.util';

@Injectable()
export class NodeService {
    private readonly pendingJobsMaxTake = Number(process.env.NODE_PENDING_JOBS_LIMIT || 25);

    constructor(private readonly r2Storage: R2Service, 
        private prisma: PrismaService,
        private jwtService: JwtService,
        @Inject(forwardRef(() => WhatsappService))
        private whatsappService: WhatsappService
    ) { }

    private async getOrCreateKiosk(nodeId: string) {
        const existing = await this.prisma.kiosk.findFirst({ where: { node_id: nodeId } });
        if (existing) {
            return existing;
        }

        return this.prisma.kiosk.create({
            data: {
                pi_id: `kiosk_${nodeId}_1`,
                node_id: nodeId,
                secret: randomUUID(),
                paper_level: 'HIGH',
                runtime_status: 'ONLINE'
            }
        });
    }

    async login(email: string, pass: string) {
        const cred = await this.prisma.nodeCredential.findUnique({
            where: { email },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        node_code: true
                    }
                }
            }
        });

        if (!cred) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isMatch = await bcrypt.compare(pass, cred.password_hash);
        if (!isMatch) {
            throw new UnauthorizedException('Invalid credentials');
        }

        await this.prisma.nodeCredential.update({
            where: { id: cred.id },
            data: { last_login: new Date() }
        });

        const payload = {
            nodeId: cred.node_id,
            nodeCode: cred.node.node_code,
            role: cred.role,
            email: cred.email
        };

        return {
            access_token: await this.jwtService.signAsync(payload),
            node: {
                id: cred.node.id,
                name: cred.node.name,
                code: cred.node.node_code
            }
        };
    }

    async updateHeartbeat(nodeId: string, paperLevel: string, printers: any[]) {
        const kiosk = await this.getOrCreateKiosk(nodeId);

        await this.prisma.kiosk.update({
            where: { pi_id: kiosk.pi_id },
            data: {
                last_heartbeat: new Date(),
                paper_level: paperLevel,
                runtime_status: deriveRuntimeStatus(paperLevel, printers),
                printer_list: printers
            }
        });

        return { success: true };
    }

    async getPendingJobs(nodeId: string) {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const take = Math.min(100, Math.max(1, this.pendingJobsMaxTake));

        const jobs = await this.prisma.printJob.findMany({
            where: {
                node_id: nodeId,
                status: 'PAID',
                OR: [
                    { claimed_at: null },
                    { claimed_at: { lt: tenMinsAgo } }
                ]
            },
            orderBy: {
                createdAt: 'asc'
            },
            take
        });

        return {
            jobs: jobs.map((job) => ({
                ...job,
                expires_at: new Date(now.getTime() + 15 * 60 * 1000)
            }))
        };
    }

    async getRecentJobs(nodeId: string, limit = 50, from?: string, to?: string, offset = 0) {
        const take = Math.min(200, Math.max(1, Number(limit) || 50));
        const skip = Math.max(0, Number(offset) || 0);
        const parsedFrom = from ? new Date(from) : null;
        const parsedTo = to ? new Date(to) : null;
        const hasFrom = parsedFrom instanceof Date && Number.isFinite(parsedFrom.getTime());
        const hasTo = parsedTo instanceof Date && Number.isFinite(parsedTo.getTime());

        const jobs = await this.prisma.printJob.findMany({
            where: {
                node_id: nodeId,
                status: { in: ['PRINTED', 'FAILED'] },
                ...(hasFrom || hasTo
                    ? {
                        updatedAt: {
                            ...(hasFrom ? { gte: parsedFrom as Date } : {}),
                            ...(hasTo ? { lt: parsedTo as Date } : {})
                        }
                    }
                    : {})
            },
            orderBy: {
                updatedAt: 'desc'
            },
            skip,
            take
        });

        return {
            jobs: jobs.map((job) => ({
                job_id: job.job_id,
                user_name: job.user_name,
                phone_number: job.phone_number,
                document_name: job.document_name,
                page_count: job.page_count,
                copies: job.copies,
                sides: job.sides,
                color_mode: job.color_mode,
                payable_amount: job.payable_amount,
                status: job.status,
                assigned_printer: job.assigned_printer,
                error_category: job.error_category,
                error_message: job.error_message,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            }))
        };
    }

    async ingestAgentEvent(nodeId: string, type: string, payload: any, time?: string) {
        if (!type) {
            throw new BadRequestException('Event type is required');
        }

        const eventTime = time ? new Date(time) : new Date();

        if (type === 'PRINTER_STATUS') {
            const printerData = payload?.printers;
            let hasLowConsumables = false;

            // Handle new summary format
            if (printerData && typeof printerData === 'object' && !Array.isArray(printerData)) {
                hasLowConsumables = Boolean(printerData.hasLowInk);
            }
            // Handle old array format
            else if (Array.isArray(printerData)) {
                hasLowConsumables = printerData.some((printer: any) => {
                    const supplies = Array.isArray(printer?.consumables) ? printer.consumables : [];
                    return supplies.some((supply: any) => Number(supply?.percent ?? 100) <= 15);
                });
            }

            const kiosk = await this.getOrCreateKiosk(nodeId);
            await this.prisma.kiosk.update({
                where: { pi_id: kiosk.pi_id },
                data: {
                    last_heartbeat: eventTime,
                    printer_list: printerData,
                    paper_level: hasLowConsumables ? 'LOW' : 'HIGH'
                }
            });
        }

        if (type === 'JOB_UPDATE') {
            const jobId = payload?.jobId;
            const status = String(payload?.status || '').toUpperCase();
            const details = payload?.details || {};

            if (!jobId) {
                throw new BadRequestException('JOB_UPDATE payload requires jobId');
            }

            if (status === 'PRINTED') {
                await this.acknowledgeJob(nodeId, jobId);
            } else if (status === 'FAILED') {
                await this.failJob(nodeId, jobId, details?.error || details?.reason || 'Print failed', details?.diagnostic || details?.error_code);
            } else if (status === 'RECEIVED' || status === 'PRINTING' || status === 'RETRYING') {
                await this.prisma.printJob.updateMany({
                    where: { job_id: jobId, node_id: nodeId },
                    data: {
                        claimed_at: eventTime,
                        claimed_by: nodeId
                    }
                });
            }
        }

        if (type === 'HEARTBEAT') {
            const isReady = Boolean(payload?.readiness?.ready ?? false);
            const kiosk = await this.getOrCreateKiosk(nodeId);
            await this.prisma.kiosk.update({
                where: { pi_id: kiosk.pi_id },
                data: {
                    last_heartbeat: eventTime,
                    runtime_status: isReady ? 'ONLINE' : 'DEGRADED'
                }
            });
        }

        return { success: true };
    }

    async acknowledgeJob(nodeId: string, jobId: string) {
        const job = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });

        if (!job) {
            throw new NotFoundException(`Job ${jobId} not found`);
        }

        if (job.node_id !== nodeId) {
            throw new NotFoundException('Job not found or unauthorized');
        }

        // Idempotent: if already printed, just return success
        if (job.status === 'PRINTED') {
            return { success: true, status: 'PRINTED', alreadyAcknowledged: true };
        }

        await this.prisma.printJob.update({
            where: { job_id: jobId },
            data: { status: 'PRINTED' }
        });

        if (job.phone_number) {
            // Look up the original sender (with platform prefix, e.g. telegram:123 or whatsapp:+91...)
            // so Telegram users receive the notification on the right channel.
            const sessionInfo = await this.whatsappService.getSessionByJobId(jobId);
            const sender = sessionInfo?.sender ?? job.phone_number;
            await this.whatsappService.updateSessionStep(sender, 'PRINTED');
            await this.whatsappService.tellStudentJobIsPrinting(sender);
        }

        return { success: true, status: 'PRINTED' };
    }

    async claimJob(nodeId: string, jobId: string) {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);

        const claimResult = await this.prisma.printJob.updateMany({
            where: {
                job_id: jobId,
                node_id: nodeId,
                status: 'PAID',
                OR: [
                    { claimed_at: null },
                    { claimed_at: { lt: tenMinsAgo } }
                ]
            },
            data: {
                claimed_at: now,
                claimed_by: nodeId
            }
        });

        if (claimResult.count === 0) {
            const existing = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });
            if (!existing || existing.node_id !== nodeId) {
                throw new NotFoundException('Job not found or unauthorized');
            }
            throw new ConflictException('Job already claimed');
        }

        const updatedJob = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });
        if (!updatedJob || updatedJob.node_id !== nodeId) {
            throw new NotFoundException('Job not found or unauthorized');
        }

        const rawFileUrls = Array.isArray(updatedJob.file_urls)
            ? (updatedJob.file_urls as any[])
            : [];

        const signedFileUrls = await Promise.all(rawFileUrls.map(async (entry) => {
            let signedFileUrl = '';
            const rawUrl = typeof entry === 'string' ? entry : String(entry?.url || '');
            const urlParts = String(rawUrl).split('/');
            const filename = urlParts[urlParts.length - 1];
            if (filename) {
                signedFileUrl = await this.r2Storage.getSignedUrl(filename, 900);
            }
            const rawCopies = Number(typeof entry === 'object' ? entry?.copies : undefined);
            return {
                url: signedFileUrl || rawUrl,
                copies: Number.isFinite(rawCopies) && rawCopies > 0 ? rawCopies : Number(updatedJob.copies || 1)
            };
        }));

        return {
            job_id: updatedJob.job_id,
            file_urls: signedFileUrls.filter((entry) => Boolean(entry)),
            file_checksum: updatedJob.file_checksum,
            copies: updatedJob.copies,
            color: updatedJob.color_mode === 'COLOR',
            sides: updatedJob.sides,
            pages: updatedJob.page_count,
            claimed_at: updatedJob.claimed_at,
            expires_at: new Date(now.getTime() + 15 * 60 * 1000)
        };
    }

    async failJob(nodeId: string, jobId: string, reason: string, errorCode?: string) {
        const job = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });
        if (!job || job.node_id !== nodeId) return { success: false };

        if (job.status === 'FAILED') {
            return { success: true, status: 'FAILED', alreadyFailed: true };
        }

        await this.prisma.printJob.update({
            where: { job_id: jobId },
            data: { status: 'FAILED' }
        });

        if (job.phone_number) {
            const msg = `❌ Sorry, your print job failed. Reason: ${reason}. \n   Please contact the shop operator.`;
            // Bypass private typing to avoid touching whatsapp module
            const waService = this.whatsappService as any;
            if (typeof waService.sendTextMessage === 'function') {
                await waService.sendTextMessage(`whatsapp:${job.phone_number}`, msg);
            }
        }

        return { success: true, status: 'FAILED' };
    }

    async getKioskStatus(nodeId: string) {
        const kiosk = await this.prisma.kiosk.findFirst({
            where: { node_id: nodeId },
            orderBy: { updatedAt: 'desc' }
        });

        const snapshot = evaluateKioskStatus(kiosk);
        return {
            nodeId,
            ...snapshot
        };
    }

    // ============================================================
    // Self-Registration Flow
    // ============================================================

    async validateRegistrationCode(code: string) {
        if (!code) throw new BadRequestException('Registration code is required');

        const regCode = await this.prisma.registrationCode.findUnique({
            where: { code },
            include: { node: true }
        });

        if (!regCode) throw new NotFoundException('Invalid registration code');
        if (regCode.used) throw new ConflictException('Registration code already used');
        if (regCode.expires_at < new Date()) throw new BadRequestException('Registration code expired');

        return {
            valid: true,
            node: {
                id: regCode.node.id,
                name: regCode.node.name,
                node_code: regCode.node.node_code,
                college: regCode.node.college,
                city: regCode.node.city
            }
        };
    }

    async registerNode(code: string, email: string, password: string) {
        const { node } = await this.validateRegistrationCode(code);

        const existing = await this.prisma.nodeCredential.findUnique({ where: { email } });
        if (existing) throw new ConflictException('Email already registered');

        const password_hash = await bcrypt.hash(password, 10);

        await this.prisma.nodeCredential.create({
            data: { node_id: node.id, email, password_hash, role: 'OPERATOR' }
        });

        await this.prisma.registrationCode.update({
            where: { code },
            data: { used: true, used_at: new Date() }
        });

        const payload = {
            nodeId: node.id,
            nodeCode: node.node_code,
            role: 'OPERATOR',
            email
        };

        return {
            access_token: await this.jwtService.signAsync(payload),
            node: { id: node.id, name: node.name, code: node.node_code }
        };
    }

    async generateRegistrationCode(nodeId: string, createdBy: string) {
        const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
        if (!node) throw new NotFoundException('Node not found');

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const random6 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const code = `CF-${node.node_code}-${random6}`;

        const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const regCode = await this.prisma.registrationCode.create({
            data: { node_id: nodeId, code, created_by: createdBy, expires_at }
        });

        return {
            code: regCode.code,
            expires_at: regCode.expires_at,
            node: { id: node.id, name: node.name, node_code: node.node_code }
        };
    }
}
