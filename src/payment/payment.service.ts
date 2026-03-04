import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrintService } from '../print/print.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        private readonly printService: PrintService,
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

        // Attempt to extract sender contact phone from payment payload if provided
        const customerPhone = paymentDetails?.contact || paymentDetails?.customer?.contact || 'whatsapp:+919999999999';
        const sender = customerPhone.includes('whatsapp:') ? customerPhone : `whatsapp:${customerPhone}`;

        const session = this.whatsappService.getSession(sender);

        if (session) {
            const jobData = {
                fileUrl: session.fileUrl,
                copies: session.copies,
                color: session.color,
                sides: session.sides,
                jobId: session.jobId || `wa_${Date.now()}`,
                sender: sender
            };

            const printSuccess = await this.printService.sendJobToPrinter(jobData);

            if (printSuccess) {
                this.logger.log(`Print job successfully triggered for order: ${orderId}`);
                // Note: We don't tellStudentJobIsPrinting here anymore. The printer's explicit Acknowledge endpoint handles it.
            } else {
                this.logger.error(`Failed to trigger print job for order: ${orderId}`);
            }
        } else {
            this.logger.warn(`Could not find active whatsapp session for sender: ${sender}`);
        }
    }
}
