import { Module } from '@nestjs/common';
import { WebFormController } from './web-form.controller';
import { WebFormService } from './web-form.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [PrismaModule, StorageModule, PaymentModule],
    controllers: [WebFormController],
    providers: [WebFormService],
})
export class WebFormModule {}
