import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import { WhatsappQueueService } from '../whatsapp/whatsapp.queue';

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

    async getAllJobs(page = 1, limit = 20, status?: string) {
        const skip = (page - 1) * limit;
        const where = status ? { status: status as any } : {};

        const [data, total] = await Promise.all([
            this.prisma.printJob.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    payment: true,
                    printToken: true
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

        const [kiosksCount, jobsToday, revenueTodayRaw, alertsCount] = await Promise.all([
            this.prisma.kiosk.count(),
            this.prisma.printJob.count({
                where: {
                    createdAt: { gte: today },
                },
            }),
            this.prisma.printJob.aggregate({
                _sum: { payable_amount: true },
                where: {
                    status: 'PAID',
                    createdAt: { gte: today },
                },
            }),
            this.prisma.kiosk.count({
                where: { paper_level: { not: 'HIGH' } },
            }),
        ]);

        return {
            totalKiosks: kiosksCount,
            jobsToday,
            revenueToday: revenueTodayRaw._sum.payable_amount || 0,
            alerts: alertsCount,
            failedPaymentsToday: await this.prisma.printJob.count({
                where: { status: 'FAILED', createdAt: { gte: today } }
            }),
            abandonedSessions: this.whatsappService.getSessions().length, // approximate
            averagePagesPerJob: await this.prisma.printJob.aggregate({
                _avg: { page_count: true },
                where: { createdAt: { gte: today } }
            }).then(res => res._avg.page_count || 0)
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
}
