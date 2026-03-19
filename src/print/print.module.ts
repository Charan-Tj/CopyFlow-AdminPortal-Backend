import { Module, forwardRef } from '@nestjs/common';
import { PrintService } from './print.service';
import { PrintController } from './print.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

import { NodeModule } from '../node/node.module';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../r2/r2.module';

@Module({
    imports: [forwardRef(() => WhatsappModule), forwardRef(() => NodeModule), PrismaModule, R2Module],
    controllers: [PrintController],
    providers: [PrintService],
    exports: [PrintService], // Make PrintService available for other modules
})
export class PrintModule { }
