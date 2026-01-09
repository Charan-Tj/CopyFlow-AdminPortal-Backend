import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { RazorpayService } from './razorpay/razorpay.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [RazorpayService],
  exports: [RazorpayService],
})
export class PaymentsModule { }
