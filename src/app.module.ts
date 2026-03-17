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
import { NodeModule } from './node/node.module';
import { WebFormModule } from './web-form/web-form.module';

@Module({
  imports: [PrismaModule, JobsModule, AdminModule, WhatsappModule, PrintModule, PaymentModule, StorageModule, NodeModule, WebFormModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
