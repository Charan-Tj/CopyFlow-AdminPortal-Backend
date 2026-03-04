import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { PaymentsModule } from '../payments/payments.module';
import { StorageModule } from '../storage/storage.module';
import { BullModule } from '@nestjs/bull';
import { WhatsappProcessor } from './whatsapp.processor';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { TwilioProvider } from './providers/twilio.provider';
import { MetaProvider } from './providers/meta.provider';

@Module({
    imports: [
        PaymentsModule,
        StorageModule,
        BullModule.forRoot({
            redis: process.env.REDIS_URL || 'redis://localhost:6379',
        }),
        BullModule.registerQueue({
            name: 'whatsapp-messages',
        })
    ],
    controllers: [WhatsappController],
    providers: [
        {
            provide: WHATSAPP_PROVIDER,
            useFactory: () => {
                const providerType = process.env.WHATSAPP_PROVIDER || 'twilio';
                return providerType === 'meta' ? new MetaProvider() : new TwilioProvider();
            }
        },
        WhatsappService,
        WhatsappProcessor
    ],
    exports: [WhatsappService],
})
export class WhatsappModule { }
