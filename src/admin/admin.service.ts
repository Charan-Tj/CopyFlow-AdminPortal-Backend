import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PhonepeService } from '../payment/phonepe/phonepe.service';
import { CashfreeService } from '../payment/cashfree/cashfree.service';
import { WhatsappQueueService } from '../whatsapp/whatsapp.queue';
import * as bcrypt from 'bcrypt';
import * as qrcode from 'qrcode';
import { evaluateKioskStatus } from '../node/kiosk-status.util';

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly whatsappService: WhatsappService,
        private readonly phonepeService: PhonepeService,
        private readonly cashfreeService: CashfreeService,
        private readonly whatsappQueue: WhatsappQueueService
    ) { }
    
    private isRecentlyOnline(lastHeartbeat?: Date | null, windowMs = 60000) {
        if (!lastHeartbeat) return false;
        const heartbeatMs = new Date(lastHeartbeat).getTime();
        if (Number.isNaN(heartbeatMs)) return false;
        return (Date.now() - heartbeatMs) < windowMs;
    }

    private isMissingNodeColumnError(error: any) {
        return error?.code === 'P2022' && error?.meta?.modelName === 'Node';
    }

    async getAllKiosks() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const kiosks = await this.prisma.kiosk.findMany({
            orderBy: { location: 'asc' },
            include: {
                node: true,
                _count: {
                    select: {
                        jobs: {
                            where: { createdAt: { gte: today } }
                        }
                    }
                }
            }
        });

        return kiosks.map(k => ({
            ...k,
            jobs_today: k._count.jobs
        }));
    }

    async getAllJobs(page = 1, limit = 20, status?: string, nodeId?: string) {
        const skip = (page - 1) * limit;
        const where: any = {};
        if (status) where.status = status;
        if (nodeId) where.node_id = nodeId;

        const [data, total] = await Promise.all([
            this.prisma.printJob.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    payment: true,
                    printToken: true,
                    node: true
                }
            }),
            this.prisma.printJob.count({ where })
        ]);

        return { data, total, page, limit };
    }

    async getAuditLogs(page = 1, limit = 50) {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                skip,
                take: Number(limit),
                orderBy: { timestamp: 'desc' },
            }),
            this.prisma.auditLog.count()
        ]);

        return { data, total, page, limit };
    }

    async getOverviewStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Run ALL queries in parallel — each saves ~200-300ms of cross-region latency
        const [kiosksCount, jobsToday, revenueTodayRaw, alertsCount, nodes, failedPayments, avgPages] = await Promise.all([
            this.prisma.kiosk.count(),
            this.prisma.printJob.count({
                where: { createdAt: { gte: today } },
            }),
            this.prisma.printJob.aggregate({
                _sum: { payable_amount: true },
                where: { status: 'PAID', createdAt: { gte: today } },
            }),
            this.prisma.kiosk.count({
                where: { paper_level: { not: 'HIGH' } },
            }),
            this.prisma.node.findMany({
                select: {
                    id: true,
                    node_code: true,
                    name: true,
                    kiosks: { select: { last_heartbeat: true } },
                    jobs: {
                        where: { createdAt: { gte: today } },
                        select: { status: true, payable_amount: true }
                    }
                }
            }),
            this.prisma.printJob.count({
                where: { status: 'FAILED', createdAt: { gte: today } }
            }),
            this.prisma.printJob.aggregate({
                _avg: { page_count: true },
                where: { createdAt: { gte: today } }
            }),
        ]);

        const nodesBreakdown = nodes.map(n => {
            const nodeJobsToday = n.jobs.length;
            const nodeRevenueToday = n.jobs
                .filter(j => j.status === 'PAID')
                .reduce((sum, j) => sum + Number(j.payable_amount), 0);
            const isOnline = n.kiosks.some(k => this.isRecentlyOnline(k.last_heartbeat));
            return {
                id: n.id, node_code: n.node_code, name: n.name,
                jobs_today: nodeJobsToday, revenue_today: nodeRevenueToday, is_online: isOnline
            };
        });

        let activeSessions = 0;
        try {
            const sessions = await this.whatsappService.getSessions();
            activeSessions = Array.isArray(sessions) ? sessions.length : 0;
        } catch {
            activeSessions = 0;
        }

        return {
            totalKiosks: kiosksCount,
            jobsToday,
            revenueToday: revenueTodayRaw._sum.payable_amount || 0,
            alerts: alertsCount,
            failedPaymentsToday: failedPayments,
            abandonedSessions: activeSessions,
            averagePagesPerJob: avgPages._avg.page_count || 0,
            nodes: nodesBreakdown
        };
    }

    async expireJob(jobId: string) {
        const job = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });
        if (!job) throw new NotFoundException('Job not found');

        const updated = await this.prisma.printJob.update({
            where: { job_id: jobId },
            data: { status: 'FAILED' }
        });

        await this.prisma.auditLog.create({
            data: {
                event: 'JOB_EXPIRED',
                actor: 'admin',
                metadata: { jobId }
            }
        });

        return updated;
    }

    async resendPayment(jobId: string) {
        const job = await this.prisma.printJob.findUnique({ where: { job_id: jobId } });
        if (!job) throw new NotFoundException('Job not found');

        const kiosk = await this.prisma.kiosk.findFirst({
            where: { node_id: job.node_id },
            orderBy: { updatedAt: 'desc' }
        });
        const kioskStatus = evaluateKioskStatus(kiosk);
        if (!kioskStatus.isPrintingReady) {
            throw new BadRequestException(`Kiosk is not ready for printing: ${kioskStatus.reason}`);
        }

        const amount = Number(job.payable_amount);
        const phone = (job.phone_number || '').replace(/^(whatsapp:|telegram:|web:)/, '') || '9999999999';
        const description = `Re-Payment for Print Job ${jobId.substring(0, 8)}`;

        let phonepeLink: string | null = null;
        try {
            phonepeLink = await this.phonepeService.createPaymentLink(amount, jobId, phone);
        } catch {
            phonepeLink = null;
        }

        let cashfreeLink: string | null = null;
        try {
            cashfreeLink = await this.cashfreeService.createPaymentLink(amount, jobId, phone, description);
        } catch {
            cashfreeLink = null;
        }

        if (!phonepeLink && !cashfreeLink) {
            throw new BadRequestException('No active payment gateway available to generate link');
        }

        return {
            paymentLink: phonepeLink || cashfreeLink,
            phonepe_link: phonepeLink,
            cashfree_link: cashfreeLink
        };
    }

    async getSessions() {
        return this.whatsappService.getSessions();
    }

    async getQueueStatus() {
        const [pending, processing, completed, jobs] = await Promise.all([
            this.whatsappQueue.getWaitingCount(),
            this.whatsappQueue.getActiveCount(),
            this.whatsappQueue.getCompletedCount(),
            this.whatsappQueue.getJobs(['waiting', 'active', 'delayed', 'failed'])
        ]);
        return { pending, processing, completed, jobs };
    }

    // ====== NODE SYSTEM OPERATIONS ====== //

    async getAllNodes() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let nodes: any[] = [];

        try {
            nodes = await this.prisma.node.findMany({
                select: {
                    id: true,
                    node_code: true,
                    name: true,
                    college: true,
                    city: true,
                    state: true,
                    pincode: true,
                    address: true,
                    latitude: true,
                    longitude: true,
                    contact_name: true,
                    contact_phone: true,
                    contact_email: true,
                    is_active: true,
                    qr_token: true,
                    kiosks: {
                        select: { last_heartbeat: true }
                    },
                    credentials: {
                        select: {
                            email: true,
                            created_at: true,
                        },
                        orderBy: { created_at: 'desc' },
                        take: 1,
                    },
                    _count: {
                        select: {
                            credentials: true,
                        },
                    },
                    jobs: {
                        where: { createdAt: { gte: today } },
                        select: { status: true, payable_amount: true }
                    }
                }
            });
        } catch (error) {
            if (!this.isMissingNodeColumnError(error)) {
                throw error;
            }

            // Backward-compatible fallback for environments where new Node columns are not migrated yet.
            nodes = await this.prisma.node.findMany({
                select: {
                    id: true,
                    node_code: true,
                    name: true,
                    college: true,
                    city: true,
                    address: true,
                    is_active: true,
                    qr_token: true,
                    kiosks: {
                        select: { last_heartbeat: true }
                    },
                    credentials: {
                        select: {
                            email: true,
                            created_at: true,
                        },
                        orderBy: { created_at: 'desc' },
                        take: 1,
                    },
                    _count: {
                        select: {
                            credentials: true,
                        },
                    },
                    jobs: {
                        where: { createdAt: { gte: today } },
                        select: { status: true, payable_amount: true }
                    }
                }
            });
        }

        return nodes.map((n: any) => {
            const isOnline = n.kiosks.some((k: any) => this.isRecentlyOnline(k.last_heartbeat));
            const hasCredentials = n._count.credentials > 0;
            const latestCredential = n.credentials[0] || null;
            return {
                id: n.id,
                node_code: n.node_code,
                name: n.name,
                college: n.college,
                city: n.city,
                state: n.state,
                pincode: n.pincode,
                address: n.address,
                latitude: n.latitude,
                longitude: n.longitude,
                contact_name: n.contact_name,
                contact_phone: n.contact_phone,
                contact_email: n.contact_email,
                is_active: n.is_active,
                kiosk_count: n.kiosks.length,
                jobs_today: n.jobs.length,
                revenue_today: n.jobs.filter((j: any) => j.status === 'PAID').reduce((sum: number, j: any) => sum + Number(j.payable_amount), 0),
                is_online: isOnline,
                qr_token: n.qr_token,
                has_credentials: hasCredentials,
                credential_email: latestCredential?.email || null,
                credential_created_at: latestCredential?.created_at || null,
            };
        });
    }

    async getNode(id: string) {
        const node = await this.prisma.node.findUnique({
            where: { id },
            include: { kiosks: true }
        });
        if (!node) throw new NotFoundException('Node not found');
        return node;
    }

    async createNode(data: any) {
        return this.prisma.node.create({
            data: {
                name: data.name,
                college: data.college,
                city: data.city,
                state: data.state,
                pincode: data.pincode,
                address: data.address,
                latitude: data.latitude,
                longitude: data.longitude,
                contact_name: data.contact_name,
                contact_phone: data.contact_phone,
                contact_email: data.contact_email,
                node_code: data.node_code
            }
        });
    }

    async toggleNode(id: string) {
        const node = await this.prisma.node.findUnique({ where: { id } });
        if (!node) throw new NotFoundException('Node not found');

        const updated = await this.prisma.node.update({
            where: { id },
            data: { is_active: !node.is_active }
        });

        await this.prisma.auditLog.create({
            data: {
                event: 'NODE_TOGGLED',
                node_id: id,
                metadata: { is_active: updated.is_active }
            }
        });

        return updated;
    }

    async createNodeCredentials(nodeId: string, email: string, plainPass: string) {
        const salt = await bcrypt.genSalt();
        const hash = await bcrypt.hash(plainPass, salt);

        const creds = await this.prisma.nodeCredential.create({
            data: {
                node_id: nodeId,
                email,
                password_hash: hash,
                role: 'OPERATOR'
            },
            include: {
                node: {
                    select: {
                        node_code: true
                    }
                }
            }
        });

        // Return created credential once so admin UI can show/copy it immediately.
        return {
            email: creds.email,
            password: plainPass,
            role: creds.role,
            node_code: creds.node.node_code,
            created_at: creds.created_at
        };
    }

    async resetNodeCredentialPassword(nodeId: string, email: string | undefined, plainPass: string, actor?: string) {
        if (!plainPass) {
            throw new BadRequestException('Password is required');
        }

        let existing;

        if (email) {
            existing = await this.prisma.nodeCredential.findUnique({
                where: { email },
                include: {
                    node: {
                        select: {
                            id: true,
                            node_code: true
                        }
                    }
                }
            });
        } else {
            existing = await this.prisma.nodeCredential.findFirst({
                where: { node_id: nodeId },
                orderBy: { created_at: 'desc' },
                include: {
                    node: {
                        select: {
                            id: true,
                            node_code: true
                        }
                    }
                }
            });
        }

        if (!existing || existing.node_id !== nodeId) {
            throw new NotFoundException('Node credential not found for this node');
        }

        const salt = await bcrypt.genSalt();
        const password_hash = await bcrypt.hash(plainPass, salt);

        const updated = await this.prisma.nodeCredential.update({
            where: { id: existing.id },
            data: { password_hash },
            include: {
                node: {
                    select: {
                        node_code: true
                    }
                }
            }
        });

        await this.prisma.auditLog.create({
            data: {
                event: 'NODE_CREDENTIAL_PASSWORD_RESET',
                node_id: nodeId,
                actor,
                metadata: { email: updated.email, role: updated.role }
            }
        });

        // Return reset credential once so admin UI can show/copy it immediately.
        return {
            email: updated.email,
            password: plainPass,
            role: updated.role,
            node_code: updated.node.node_code,
            created_at: updated.created_at,
            reset_at: new Date()
        };
    }

    async generateNodeQr(id: string) {
        const node = await this.prisma.node.findUnique({ where: { id } });
        if (!node) throw new NotFoundException('Node not found');

        const phoneNumber = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
        let cleanPhone = phoneNumber;
        if (cleanPhone.startsWith('whatsapp:')) {
            cleanPhone = cleanPhone.replace('whatsapp:', '');
        }

        const waLink = `https://wa.me/${cleanPhone}?text=START ${node.qr_token}`;
        const base64Qr = await qrcode.toDataURL(waLink);

        return { qrCode: base64Qr, link: waLink, node_code: node.node_code };
    }
}
