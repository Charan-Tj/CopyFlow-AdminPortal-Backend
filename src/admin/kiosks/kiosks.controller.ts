import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { KiosksService } from './kiosks.service';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Admin Kiosks')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/kiosks')
export class KiosksController {
    constructor(private readonly kiosksService: KiosksService) { }

    @Get()
    @ApiOperation({ summary: 'List all kiosks with status' })
    async findAll() {
        return this.kiosksService.findAll();
    }

    @Post(':pi_id/refill')
    @ApiOperation({ summary: 'Trigger paper refill for a kiosk' })
    async refillKiosk(@Param('pi_id') piId: string, @Req() req: any) {
        return this.kiosksService.refillKiosk(piId, req.user.email);
    }
}
