import { Controller, Get, Param, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { TokensService } from './tokens.service';
import { KioskAuthGuard } from '../../common/guards/kiosk-auth.guard';

@Controller('kiosks/:pi_id/jobs/:job_id/token')
@UseGuards(KioskAuthGuard)
export class TokensController {
    constructor(private readonly tokensService: TokensService) { }

    @Get()
    async getToken(
        @Param('pi_id') kioskId: string,
        @Param('job_id') jobId: string,
        @Req() req: any,
    ) {
        // Ensure the authenticated Kiosk matches the URL param
        if (req.kiosk.pi_id !== kioskId) {
            throw new UnauthorizedException('Kiosk ID mismatch');
        }

        const token = await this.tokensService.generateToken(jobId, kioskId);
        return { token };
    }
}
