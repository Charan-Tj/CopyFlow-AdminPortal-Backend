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
                // merchantTransactionId is our internal reference (e.g. web_*, wa_*).
                // transactionId is PhonePe's provider transaction id and cannot be used for session lookup.
                const orderId = decoded?.data?.merchantTransactionId || decoded?.data?.transactionId;

                if (!orderId) {
                    this.logger.error(`PhonePe callback missing both merchantTransactionId and transactionId: ${decodedString}`);
                    throw new BadRequestException('Missing PhonePe transaction reference');
                }

                this.logger.log(
                    `Triggering print for PhonePe Order. merchantTransactionId=${decoded?.data?.merchantTransactionId}, transactionId=${decoded?.data?.transactionId}, chosenOrderId=${orderId}`,
                );
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
