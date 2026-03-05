import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PricingModule } from './pricing/pricing.module';
import { KiosksModule } from './kiosks/kiosks.module';

import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PricingModule,
    KiosksModule,
    WhatsappModule,
    PaymentModule
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule { }
