import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Admin Pricing')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/pricing')
export class PricingController {
    constructor(private readonly prisma: PrismaService) { }

    @Get()
    @ApiOperation({ summary: 'Get current pricing configuration' })
    async getCurrentPricing() {
        return this.prisma.pricingConfig.findFirst({
            where: { active: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    @Post()
    @ApiOperation({ summary: 'Update pricing configuration' })
    @ApiBody({ schema: { type: 'object', properties: { bw_price: { type: 'number' }, color_price: { type: 'number' } } } })
    async updatePricing(@Body() body: { bw_price: number; color_price: number }, @Req() req: any) {

        return this.prisma.pricingConfig.create({
            data: {
                bw_price: body.bw_price,
                color_price: body.color_price,
                author: req.user.email,
                active: true,
            },
        });
    }
}
