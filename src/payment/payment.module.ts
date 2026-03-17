import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrintModule } from '../print/print.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RazorpayService } from './razorpay/razorpay.service';
import { PhonepeService } from './phonepe/phonepe.service';
import { CashfreeService } from './cashfree/cashfree.service';

@Module({
    imports: [forwardRef(() => PrintModule), forwardRef(() => WhatsappModule)],
    controllers: [PaymentController],
    providers: [PaymentService, RazorpayService, PhonepeService, CashfreeService],
    exports: [PaymentService, RazorpayService, PhonepeService, CashfreeService],
})
export class PaymentModule { }
