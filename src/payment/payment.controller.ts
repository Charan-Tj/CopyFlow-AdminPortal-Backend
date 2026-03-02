import { Controller, Post, Headers, Req, BadRequestException, Logger } from '@nestjs/common';
import { PaymentService } from './payment.service';
import type { Request } from 'express';

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
        @Req() req: Request,
    ) {
        const rawBody = (req as any).rawBody;
        const bodyObj = req.body;

        this.logger.log(`Received Razorpay webhook event: ${bodyObj?.event}`);
        this.logger.log(`rawBody type: ${typeof rawBody}, isBuffer: ${Buffer.isBuffer(rawBody)}, length: ${rawBody?.length}`);

        if (!signature) {
            this.logger.error('Missing Razorpay signature');
            throw new BadRequestException('Missing Razorpay signature');
        }

        // Pass the untampered raw buffer/string to signature verification
        const isValid = this.paymentService.verifyPaymentSignature(rawBody, signature);

        if (!isValid) {
            this.logger.error('Invalid Razorpay signature in webhook payload');
            throw new BadRequestException('Invalid signature');
        }

        const event = bodyObj.event;
        this.logger.log(`Webhook Event Validated: ${event}`);

        // Process payment validation and confirm print job
        if (event === 'payment.captured' || event === 'payment_link.paid') {
            const paymentPayload = bodyObj.payload.payment ? bodyObj.payload.payment.entity : null;
            const paymentLinkPayload = bodyObj.payload.payment_link ? bodyObj.payload.payment_link.entity : null;

            // For explicitly created orders, we use order_id. For payment links, we use reference_id
            const orderId = paymentPayload?.order_id || paymentLinkPayload?.reference_id || 'unknown_order';

            this.logger.log(`Triggering print for Order/Reference ID: ${orderId}`);

            await this.paymentService.processPaymentAndTriggerPrint(orderId, paymentPayload || paymentLinkPayload);
        }

        // Acknowledge the webhook event
        return { status: 'ok' };
    }
}
