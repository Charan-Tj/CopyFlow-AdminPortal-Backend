import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PrintModule } from './print/print.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [PrismaModule, JobsModule, PaymentsModule, AdminModule, WhatsappModule, PrintModule, PaymentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
