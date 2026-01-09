import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KioskAuthGuard implements CanActivate {
    constructor(private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        console.log('Headers:', request.headers); // DEBUG LOG
        const pi_id = request.headers['x-kiosk-id'];
        const secret = request.headers['x-kiosk-secret'];

        if (!pi_id || !secret) {
            throw new UnauthorizedException('Missing Kiosk Credentials');
        }

        const kiosk = await this.prisma.kiosk.findUnique({
            where: { pi_id: String(pi_id) },
        });

        if (!kiosk || kiosk.secret !== secret) {
            throw new UnauthorizedException('Invalid Kiosk Credentials');
        }

        // Attach kiosk to request for controller use
        request['kiosk'] = kiosk;
        return true;
    }
}
