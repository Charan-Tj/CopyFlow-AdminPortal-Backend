import { Injectable } from '@nestjs/common';
import { ColorMode } from '@prisma/client';

@Injectable()
export class PricingService {
    private readonly BW_PRICE = 2.0;
    private readonly COLOR_PRICE = 10.0;

    calculatePrice(pages: number, colorMode: ColorMode): number {
        const rate = colorMode === ColorMode.COLOR ? this.COLOR_PRICE : this.BW_PRICE;
        return pages * rate;
    }
}
