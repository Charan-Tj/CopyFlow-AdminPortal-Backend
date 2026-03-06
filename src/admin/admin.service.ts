import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import { WhatsappQueueService } from '../whatsapp/whatsapp.queue';
import * as bcrypt from 'bcrypt';
import * as qrcode from 'qrcode';

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly whatsappService: WhatsappService,
        private readonly razorpayService: RazorpayService,
        private readonly whatsappQueue: WhatsappQueueService
    ) { }

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
                include: {
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
            const isOnline = n.kiosks.some(k =>
                (new Date().getTime() - k.last_heartbeat.getTime()) < 60000
            );
            return {
                id: n.id, node_code: n.node_code, name: n.name,
                jobs_today: nodeJobsToday, revenue_today: nodeRevenueToday, is_online: isOnline
            };
        });

        return {
            totalKiosks: kiosksCount,
            jobsToday,
            revenueToday: revenueTodayRaw._sum.payable_amount || 0,
            alerts: alertsCount,
            failedPaymentsToday: failedPayments,
            abandonedSessions: this.whatsappService.getSessions().length,
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

        const paymentLinkObj = await this.razorpayService.createPaymentLink(
            Number(job.payable_amount),
            jobId,
            `Re-Payment for Print Job ${jobId.substring(0, 8)}`,
            '9999999999'
        );

        return { paymentLink: paymentLinkObj.short_url || 'https://razorpay.com/' };
    }

    getSessions() {
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

        const nodes = await this.prisma.node.findMany({
            include: {
                kiosks: true,
                jobs: {
                    where: { createdAt: { gte: today } }
                }
            }
        });

        return nodes.map(n => {
            const isOnline = n.kiosks.some(k => (new Date().getTime() - k.last_heartbeat.getTime()) < 60000);
            return {
                id: n.id,
                node_code: n.node_code,
                name: n.name,
                college: n.college,
                city: n.city,
                address: n.address,
                is_active: n.is_active,
                kiosk_count: n.kiosks.length,
                jobs_today: n.jobs.length,
                revenue_today: n.jobs.filter(j => j.status === 'PAID').reduce((sum, j) => sum + Number(j.payable_amount), 0),
                is_online: isOnline,
                qr_token: n.qr_token
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
                address: data.address,
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
            include: { node: true }
        });

        return { email: creds.email, node_code: creds.node.node_code };
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
