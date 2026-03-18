import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { evaluateKioskStatus } from '../../node/kiosk-status.util';

@Injectable()
export class KiosksService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        const kiosks = await this.prisma.kiosk.findMany({
            orderBy: { pi_id: 'asc' },
        });

        return kiosks.map((kiosk) => ({
            ...kiosk,
            status_snapshot: evaluateKioskStatus(kiosk)
        }));
    }

    async refillKiosk(pi_id: string, userEmail: string) {
        const kiosk = await this.prisma.kiosk.findUnique({ where: { pi_id } });
        if (!kiosk) {
            throw new NotFoundException('Kiosk not found');
        }

        // Update payload
        const updated = await this.prisma.kiosk.update({
            where: { pi_id },
            data: { paper_level: 'HIGH' },
        });

        // Log audit
        await this.prisma.auditLog.create({
            data: {
                event: 'KIOSK_REFILL',
                actor: userEmail,
                metadata: { kioskId: pi_id, previousLevel: kiosk.paper_level },
            },
        });

        return updated;
    }
}
