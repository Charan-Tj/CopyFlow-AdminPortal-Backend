import { Controller, Post, Headers, Body, BadRequestException, Logger } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payment-webhook')
export class PaymentController {
    private readonly logger = new Logger(PaymentController.name);

    constructor(private readonly paymentService: PaymentService) { }

    /**
     * Controller for Razorpay Webhook Events
     */
    @Post()
    async handleRazorpayWebhook(
        @Headers('x-razorpay-signature') signature: string,
        @Body() body: any,
    ) {
        this.logger.log(`Received Razorpay webhook event: ${body?.event}`);

        if (!signature) {
            this.logger.error('Missing Razorpay signature');
            throw new BadRequestException('Missing Razorpay signature');
        }

        const isValid = this.paymentService.verifyPaymentSignature(JSON.stringify(body), signature);

        if (!isValid) {
            this.logger.error('Invalid Razorpay signature in webhook payload');
            throw new BadRequestException('Invalid signature');
        }

        const event = body.event;
        this.logger.log(`Webhook Event Validated: ${event}`);

        // Process payment validation and confirm print job
        if (event === 'payment.captured' || event === 'payment_link.paid') {
            const paymentPayload = body.payload.payment ? body.payload.payment.entity : null;
            const paymentLinkPayload = body.payload.payment_link ? body.payload.payment_link.entity : null;

            // For explicitly created orders, we use order_id. For payment links, we use reference_id
            const orderId = paymentPayload?.order_id || paymentLinkPayload?.reference_id || 'unknown_order';

            this.logger.log(`Triggering print for Order/Reference ID: ${orderId}`);

            await this.paymentService.processPaymentAndTriggerPrint(orderId, paymentPayload || paymentLinkPayload);
        }

        // Acknowledge the webhook event
        return { status: 'ok' };
    }
}
