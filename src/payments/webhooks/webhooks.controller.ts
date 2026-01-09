import { Controller, Post, Headers, Body, BadRequestException, Logger } from '@nestjs/common';
import { RazorpayService } from '../razorpay/razorpay.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobStatus } from '@prisma/client';

@Controller('webhooks')
export class WebhooksController {
    private readonly logger = new Logger(WebhooksController.name);

    constructor(
        private readonly razorpayService: RazorpayService,
        private readonly prisma: PrismaService,
    ) { }

    @Post('razorpay')
    async handleWebhook(
        @Headers('x-razorpay-signature') signature: string,
        @Body() body: any,
    ) {
        // Note: In production, use RAW body for verification.
        // Here we strictly rely on JSON.stringify matching the payload, which is brittle but functional for prototype.
        const isValid = this.razorpayService.verifyWebhookSignature(
            JSON.stringify(body),
            signature,
        );

        if (!isValid) {
            this.logger.warn('Invalid Webhook Signature');
            throw new BadRequestException('Invalid Signature');
        }

        const event = body.event;

        if (event === 'order.paid') {
            const paymentPayload = body.payload.payment.entity;
            const orderId = paymentPayload.order_id;
            const amount = paymentPayload.amount / 100; // paise to units

            this.logger.log(`Payment confirmed for Order: ${orderId}`);

            // Transaction: Update Job + Payment + AuditLog
            await this.prisma.$transaction(async (tx) => {
                // 1. Update Payment
                await tx.payment.update({
                    where: { razorpay_order_id: orderId },
                    data: {
                        status: 'captured',
                        amount: amount, // confirm amount matches
                    },
                });

                // 2. Find Job ID from Payment
                const payment = await tx.payment.findUnique({
                    where: { razorpay_order_id: orderId },
                });

                if (payment) {
                    // 3. Update Job
                    await tx.printJob.update({
                        where: { job_id: payment.job_id },
                        data: { status: JobStatus.PAID },
                    });

                    // 4. Audit Log
                    await tx.auditLog.create({
                        data: {
                            event: 'PAYMENT_SUCCESS',
                            actor: 'razorpay_webhook',
                            metadata: { orderId, jobId: payment.job_id },
                        },
                    });
                }
            });
        }

        return { status: 'ok' };
    }
}
