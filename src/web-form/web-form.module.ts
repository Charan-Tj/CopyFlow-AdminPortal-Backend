import { Module } from '@nestjs/common';
import { WebFormController } from './web-form.controller';
import { WebFormService } from './web-form.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import { PhonepeService } from '../payment/phonepe/phonepe.service';

@Module({
    imports: [PrismaModule, StorageModule],
    controllers: [WebFormController],
    providers: [WebFormService, RazorpayService, PhonepeService],
})
export class WebFormModule {}
