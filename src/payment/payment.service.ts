import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrintService } from '../print/print.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);
    private readonly inFlightOrders = new Set<string>();

    constructor(
        @Inject(forwardRef(() => PrintService))
        private readonly printService: PrintService,
        @Inject(forwardRef(() => WhatsappService))
        private readonly whatsappService: WhatsappService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Upon successful payment confirmation, processes it and calls the print service.
     * On success, tells the user via WhatsApp that the job is printing.
     */
    async processPaymentAndTriggerPrint(orderId: string, paymentDetails: any): Promise<void> {
        if (!orderId) {
            this.logger.warn('Skipping payment processing because orderId is empty');
            return;
        }

        if (this.inFlightOrders.has(orderId)) {
            this.logger.log(`Skipping duplicate in-flight payment processing for order: ${orderId}`);
            return;
        }

        this.inFlightOrders.add(orderId);

        try {
        this.logger.log(`Processing confirmed webhook payment for order: ${orderId}`);

        const existingJob = await this.prisma.printJob.findUnique({
            where: { job_id: orderId },
            select: { job_id: true, status: true }
        });

        if (existingJob) {
            this.logger.log(`Order already processed, skipping duplicate processing for order: ${orderId}, status=${existingJob.status}`);
            return;
        }

        // Prefer lookup by provider reference_id first.
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
            const universalCopies = Number(session.copies || 1);
            const safeUniversalCopies = Number.isFinite(universalCopies) && universalCopies > 0 ? universalCopies : 1;

            const fileUrls = Array.isArray(session.files)
                ? session.files
                    .map((file: any) => {
                        const url = String(file?.url || '').trim();
                        if (!url) {
                            return null;
                        }

                        const perFileCopies = Number(file?.copies ?? safeUniversalCopies);
                        return {
                            url,
                            copies: Number.isFinite(perFileCopies) && perFileCopies > 0 ? perFileCopies : safeUniversalCopies
                        };
                    })
                    .filter((entry: any) => Boolean(entry))
                : [];

            const jobData = {
                fileUrl: fileUrls[0]?.url,
                fileUrls,
                files: session.files || [],
                copies: safeUniversalCopies,
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
        } finally {
            this.inFlightOrders.delete(orderId);
        }
    }
}
