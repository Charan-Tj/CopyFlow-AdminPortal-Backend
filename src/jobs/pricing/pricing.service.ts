import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ColorMode } from '@prisma/client';

@Injectable()
export class PricingService {
    private readonly logger = new Logger(PricingService.name);

    constructor(private readonly prisma: PrismaService) { }

    async calculatePrice(pageCount: number, colorMode: ColorMode): Promise<number> {
        // Fetch latest active pricing
        const config = await this.prisma.pricingConfig.findFirst({
            where: { active: true },
            orderBy: { createdAt: 'desc' },
        });

        let bwRate = 2.0;
        let colorRate = 10.0;

        if (config) {
            bwRate = Number(config.bw_price);
            colorRate = Number(config.color_price);
        } else {
            this.logger.warn('No active PricingConfig found. Using fallback defaults.');
        }

        const rate = colorMode === ColorMode.COLOR ? colorRate : bwRate;
        return pageCount * rate;
    }
}
