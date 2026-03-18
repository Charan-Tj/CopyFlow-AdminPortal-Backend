import { Module, forwardRef } from '@nestjs/common';
import { NodeController } from './node.controller';
import { NodeService } from './node.service';
import { NodeGateway } from './node.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

import { R2Module } from '../r2/r2.module';

@Module({
    imports: [
        PrismaModule,
        R2Module,
        forwardRef(() => WhatsappModule),
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'secretKey',
            signOptions: { expiresIn: '7d' },
        }),
    ],
    controllers: [NodeController],
    providers: [NodeService, NodeGateway],
    exports: [NodeService, NodeGateway],
})
export class NodeModule { }
