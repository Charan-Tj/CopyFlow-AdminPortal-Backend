import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PrintModule } from './print/print.module';
import { PaymentModule } from './payment/payment.module';
import { R2Module } from './r2/r2.module';
import { NodeModule } from './node/node.module';
import { WebFormModule } from './web-form/web-form.module';
import { KioskApiModule } from './kiosk-api/kiosk-api.module';

@Module({
  imports: [PrismaModule, JobsModule, AdminModule, WhatsappModule, PrintModule, PaymentModule, R2Module, NodeModule, WebFormModule, KioskApiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
