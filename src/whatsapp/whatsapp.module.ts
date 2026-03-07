import { Module, forwardRef } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { PaymentModule } from '../payment/payment.module';
import { StorageModule } from '../storage/storage.module';
import { WhatsappQueueService } from './whatsapp.queue';
import { TwilioProvider } from './providers/twilio.provider';
import { MetaProvider } from './providers/meta.provider';
import { TelegramProvider } from './providers/telegram.provider';

import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [
        forwardRef(() => PaymentModule),
        StorageModule,
        PrismaModule
    ],
    controllers: [WhatsappController],
    providers: [
        TwilioProvider,
        MetaProvider,
        TelegramProvider,
        WhatsappService,
        WhatsappQueueService
    ],
    exports: [WhatsappService, WhatsappQueueService],
})
export class WhatsappModule { }
