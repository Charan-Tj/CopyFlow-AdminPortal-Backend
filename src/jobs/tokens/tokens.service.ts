import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class TokensService {
    constructor(private readonly prisma: PrismaService) { }

    async generateToken(jobId: string, kioskId: string): Promise<string> {
        const job = await this.prisma.printJob.findUnique({
            where: { job_id: jobId },
            include: { printToken: true }, // Check if token exists
        });

        if (!job) {
            throw new NotFoundException('Job not found');
        }

        if (job.kiosk_id !== kioskId) {
            throw new UnauthorizedException('Job does not belong to this Kiosk');
        }

        if (job.status !== JobStatus.PAID) {
            if (job.status === JobStatus.PRINTED) {
                throw new BadRequestException('Job already printed');
            }
            throw new BadRequestException('Job is not PAID');
        }

        // Check if valid token already exists (Optional optimization, but good for stability)
        // For now, always generate a fresh one or update existing?
        // Let's generate a fresh one and upsert.

        const expiry = Date.now() + 1000 * 60 * 60; // 1 hour
        const payload = `${jobId}:${kioskId}:${expiry}`;
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'fallback_secret';

        const signature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        const token = `${payload}.${signature}`;

        // Store/Update Token Record
        await this.prisma.printToken.upsert({
            where: { job_id: jobId },
            update: {
                token_hash: signature, // Storing signature as "hash" for simple verification later
                expires_at: new Date(expiry),
                used: false,
            },
            create: {
                job_id: jobId,
                token_hash: signature,
                expires_at: new Date(expiry),
                used: false,
            },
        });

        return token;
    }
}
