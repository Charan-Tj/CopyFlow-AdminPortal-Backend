import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PrintModule } from './print/print.module';
import { PaymentModule } from './payment/payment.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [PrismaModule, JobsModule, AdminModule, WhatsappModule, PrintModule, PaymentModule, StorageModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
