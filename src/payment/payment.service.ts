import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrintService } from '../print/print.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        @Inject(forwardRef(() => PrintService))
        private readonly printService: PrintService,
        @Inject(forwardRef(() => WhatsappService))
        private readonly whatsappService: WhatsappService,
    ) { }

    /**
     * Verifies the Razorpay webhook signature for authenticity
     */
    verifyPaymentSignature(body: string, signature: string): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!secret) {
            this.logger.error('RAZORPAY_WEBHOOK_SECRET environment variable is missing.');
            return false;
        }

        // Create expected signature using crypto HMAC
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');

        return expectedSignature === signature;
    }

    /**
     * Upon successful payment confirmation, processes it and calls the print service.
     * On success, tells the user via WhatsApp that the job is printing.
     */
    async processPaymentAndTriggerPrint(orderId: string, paymentDetails: any): Promise<void> {
        this.logger.log(`Processing confirmed webhook payment for Razorpay order: ${orderId}`);

        // ── Bug 2 fix: look up session by jobId (our reference_id) first ──
        // The orderId from `payment_link.paid` is our reference_id (e.g. `wa_1709...`).
        let session: any = undefined;
        let sender: string | undefined;

        const byJob = await this.whatsappService.getSessionByJobId(orderId);
        if (byJob) {
            session = byJob.session;
            sender = byJob.sender;
            this.logger.log(`Found session via jobId lookup for orderId: ${orderId}, sender: ${sender}`);
        }

        // Fallback: try phone-based lookup from payment payload
        if (!session) {
            const customerPhone =
                paymentDetails?.customer?.contact ||
                paymentDetails?.contact ||
                paymentDetails?.notes?.customer_phone;

            if (customerPhone) {
                const normalizedSender = customerPhone.includes('whatsapp:')
                    ? customerPhone
                    : `whatsapp:${customerPhone}`;

                session = await this.whatsappService.getSessionAsync(normalizedSender);
                if (session) {
                    sender = normalizedSender;
                    this.logger.log(`Found session via phone lookup for sender: ${sender}`);
                }
            }
        }

        if (session && sender) {
            const jobData = {
                fileUrl: session.files?.length > 0 ? session.files[0].url : undefined,
                files: session.files || [],
                copies: session.copies,
                color: session.color,
                sides: session.sides,
                pages: session.pages,
                nodeId: session.nodeId,
                jobId: session.jobId || `wa_${Date.now()}`,
                sender: sender
            };

            const printSuccess = await this.printService.sendJobToPrinter(jobData);

            if (printSuccess) {
                this.logger.log(`Print job successfully triggered for order: ${orderId}`);
                
                // Update the session step to PAID so it doesn't linger as AWAITING_PAYMENT in dashboards
                await this.whatsappService.updateSessionStep(sender, 'PAID');

                // Immediate user feedback so they know payment was received.
                // The kiosk-acknowledge path sends the follow-up "job printed" message.
                await this.whatsappService.notifyPaymentConfirmed(sender);
            } else {
                this.logger.error(`Failed to trigger print job for order: ${orderId}`);
            }
        } else {
            this.logger.warn(`Could not find active whatsapp session for orderId: ${orderId}`);
        }
    }
}
