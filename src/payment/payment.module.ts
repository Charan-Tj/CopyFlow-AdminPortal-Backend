import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrintModule } from '../print/print.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [PrintModule, WhatsappModule],
    controllers: [PaymentController],
    providers: [PaymentService],
    exports: [PaymentService],
})
export class PaymentModule { }
