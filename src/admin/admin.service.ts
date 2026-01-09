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

    async getAllJobs(limit = 20) {
        return this.prisma.printJob.findMany({
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                payment: true,
                printToken: true
            }
        });
    }

    async getAuditLogs(limit = 50) {
        return this.prisma.auditLog.findMany({
            take: limit,
            orderBy: { timestamp: 'desc' },
        });
    }
}
