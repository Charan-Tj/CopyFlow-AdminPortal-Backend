import { Module } from '@nestjs/common';
import { WebFormController } from './web-form.controller';
import { WebFormService } from './web-form.service';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../r2/r2.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [PrismaModule, R2Module, PaymentModule],
    controllers: [WebFormController],
    providers: [WebFormService],
})
export class WebFormModule {}
