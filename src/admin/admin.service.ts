import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
    constructor(private readonly prisma: PrismaService) { }

    async getAllKiosks() {
        return this.prisma.kiosk.findMany({
            orderBy: { location: 'asc' },
        });
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
        };
    }
}
