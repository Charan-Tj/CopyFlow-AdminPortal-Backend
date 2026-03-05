import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing/pricing.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobStatus } from '@prisma/client';

@Injectable()
export class JobsService {
    constructor(
        private prisma: PrismaService,
        private pricingService: PricingService,
    ) { }

    async createJob(kioskId: string, dto: CreateJobDto) {
        const payableAmount = await this.pricingService.calculatePrice(
            dto.page_count,
            dto.color_mode,
        );

        const kiosk = await this.prisma.kiosk.findUnique({ where: { pi_id: kioskId } });
        if (!kiosk || !kiosk.node_id) {
            throw new Error('Kiosk or Node not found');
        }

        return this.prisma.printJob.create({
            data: {
                kiosk_id: kioskId,
                node_id: kiosk.node_id,
                page_count: dto.page_count,
                color_mode: dto.color_mode,
                status: JobStatus.UPLOADED,
                payable_amount: payableAmount,
            },
        });
    }
}
