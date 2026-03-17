import { Controller, Post, Headers, Req, BadRequestException, Logger } from '@nestjs/common';
import { PaymentService } from './payment.service';
import type { Request } from 'express';

import { PhonepeService } from './phonepe/phonepe.service';
import { CashfreeService } from './cashfree/cashfree.service';

@Controller('payment-webhook')
export class PaymentController {
    private readonly logger = new Logger(PaymentController.name);

    constructor(
        private readonly paymentService: PaymentService,
        private readonly phonepeService: PhonepeService,
        private readonly cashfreeService: CashfreeService
    ) { }

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
        // We only trigger off 'payment_link.paid' because 'payment.captured' also fires for link payments causing duplicate notifications
        if (event === 'payment_link.paid') {
            const paymentPayload = bodyObj.payload.payment ? bodyObj.payload.payment.entity : null;
            const paymentLinkPayload = bodyObj.payload.payment_link ? bodyObj.payload.payment_link.entity : null;

            // For explicitly created orders, we use order_id. For payment links, we use reference_id
            const orderId = paymentLinkPayload?.reference_id || paymentPayload?.order_id || 'unknown_order';

            this.logger.log(`Triggering print for Order/Reference ID: ${orderId}`);

            await this.paymentService.processPaymentAndTriggerPrint(orderId, paymentPayload || paymentLinkPayload);
        }

        // Acknowledge the webhook event
        return { status: 'ok' };
    }

    /**
     * Controller for PhonePe Webhook Events
     */
    @Post('phonepe')
    async handlePhonePeWebhook(
        @Headers('x-verify') xVerify: string,
        @Req() req: Request,
    ) {
        try {
            const bodyObj = req.body;
            this.logger.log(`Received PhonePe webhook event. xVerify header: ${xVerify}`);
            this.logger.log(`PhonePe Webhook Body: ${JSON.stringify(bodyObj)}`);
            this.logger.log(`PhonePe Webhook raw headers: ${JSON.stringify(req.headers)}`);

            // Also check uppercase header if it's there
            const checksum = xVerify || req.headers['x-verify'] || (req.headers['X-VERIFY'] as string);

            if (!checksum || !bodyObj || !bodyObj.response) {
                this.logger.error('Missing PhonePe signature or response');
                throw new BadRequestException('Invalid PhonePe callback');
            }

            const isValid = this.phonepeService.verifyWebhookSignature(bodyObj.response, checksum as string);
            if (!isValid) {
                this.logger.error('Invalid PhonePe signature');
                throw new BadRequestException('Invalid PhonePe signature');
            }

            // decode base64
            const decodedString = Buffer.from(bodyObj.response, 'base64').toString('utf8');
            const decoded = JSON.parse(decodedString);

            if (decoded.success && decoded.code === 'PAYMENT_SUCCESS') {
                const orderId = decoded.data.transactionId || decoded.data.merchantTransactionId;
                this.logger.log(`Triggering print for PhonePe Order: ${orderId}`);
                await this.paymentService.processPaymentAndTriggerPrint(orderId, decoded.data);
            } else {
                this.logger.log(`PhonePe payment not successful: ${decoded.code}`);
            }

            return { status: 'ok' };
        } catch (error) {
            this.logger.error(`Error in handlePhonePeWebhook: ${error}`);
            throw new BadRequestException('PhonePe Webhook failed');
        }
    }

    /**
     * Controller for Cashfree Webhook Events
     */
    @Post('cashfree')
    async handleCashfreeWebhook(
        @Headers('x-webhook-signature') signature: string,
        @Headers('x-webhook-timestamp') timestamp: string,
        @Req() req: Request,
    ) {
        try {
            const rawBody = (req as any).rawBody;
            const bodyObj = req.body;
            this.logger.log(`Received Cashfree webhook event. signature header: ${signature}, timestamp: ${timestamp}`);

            if (!signature || !timestamp || !rawBody) {
                this.logger.error('Missing Cashfree signature, timestamp or body');
                throw new BadRequestException('Invalid Cashfree callback');
            }

            const isValid = this.cashfreeService.verifyWebhookSignature(rawBody.toString(), signature, timestamp);
            if (!isValid) {
                this.logger.error('Invalid Cashfree signature');
                throw new BadRequestException('Invalid Cashfree signature');
            }

            if (bodyObj.data && bodyObj.data.payment && bodyObj.data.payment.payment_status === 'SUCCESS') {
                const orderId = bodyObj.data.order && bodyObj.data.order.order_id;
                // For link payments, link_id is usually passed as order_id or accessible differently.
                // Cashfree links typically create an order where order_id = link_id
                this.logger.log(`Triggering print for Cashfree Order: ${orderId}`);
                await this.paymentService.processPaymentAndTriggerPrint(orderId, bodyObj.data);
            } else {
                this.logger.log(`Cashfree payment not successful or different event: ${bodyObj.type}`);
            }

            return { status: 'ok' };
        } catch (error) {
            this.logger.error(`Error in handleCashfreeWebhook: ${error}`);
            throw new BadRequestException('Cashfree Webhook failed');
        }
    }
}
