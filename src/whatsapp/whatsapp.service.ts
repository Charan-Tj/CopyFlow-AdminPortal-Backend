import { Injectable, Logger } from '@nestjs/common';
import { RazorpayService } from '../payments/razorpay/razorpay.service';
import * as twilio from 'twilio';

interface ChatState {
    step: 'AWAITING_FILE' | 'AWAITING_SETTINGS' | 'AWAITING_PAYMENT';
    fileUrl?: string;
    copies?: number;
    color?: boolean;
    sides?: 'single' | 'double';
    price?: number;
    paymentLink?: string;
}

@Injectable()
export class WhatsappService {
    private readonly logger = new Logger(WhatsappService.name);

    // In-memory state tracking for conversation flow.
    private userSessions = new Map<string, ChatState>();
    private twilioClient: twilio.Twilio;

    constructor(private readonly razorpayService: RazorpayService) {
        // Initialize Twilio client
        this.twilioClient = new twilio.Twilio(
            process.env.TWILIO_ACCOUNT_SID || 'ACtest',
            process.env.TWILIO_AUTH_TOKEN || 'testtoken'
        );
    }

    /**
     * Main flow handler for incoming Twilio WhatsApp messages
     */
    async handleIncomingMessage(sender: string, message: string, mediaUrl?: string): Promise<string> {
        this.logger.log(`Received message from ${sender}: ${message}`);

        let session = this.userSessions.get(sender);

        // Default to a new session if not found
        if (!session) {
            session = { step: 'AWAITING_FILE' };
            this.userSessions.set(sender, session);
        }

        // Phase 1: Awaiting file (PDF/Word/image)
        if (session.step === 'AWAITING_FILE') {
            if (mediaUrl) {
                // Bot nominally downloads file from Twilio media URL here
                session.fileUrl = mediaUrl;
                session.step = 'AWAITING_SETTINGS';
                return 'File received! Please reply with your print preferences in this format: [number_of_copies], [bw or color], [single or double]\nExample: 2, bw, single';
            }
            return 'Welcome to CopyFlow! Please send a file (PDF/Word/image) to get started.';
        }

        // Phase 2: Awaiting print settings (copies, B&W or color, single or double sided)
        if (session.step === 'AWAITING_SETTINGS') {
            const preferences = message.toLowerCase().split(',').map(s => s.trim());

            if (preferences.length >= 3) {
                const copies = parseInt(preferences[0], 10) || 1;
                const color = preferences[1] === 'color';
                const sides = preferences[2] === 'double' ? 'double' : 'single';

                session.copies = copies;
                session.color = color;
                session.sides = sides;

                // Calculate price (₹2 per B&W page, ₹10 color) - assuming 1 page per document statically
                const pages = 1;
                const pricePerPage = color ? 10 : 2;
                session.price = copies * pages * pricePerPage;

                session.step = 'AWAITING_PAYMENT';

                // Generate Razorpay payment link via API
                try {
                    const referenceId = `wa_${Date.now()}`;
                    const cleanedPhone = sender.replace('whatsapp:', '');
                    const paymentLinkObj = await this.razorpayService.createPaymentLink(
                        session.price,
                        referenceId,
                        `Print job (${copies}x ${sides} ${color ? 'Color' : 'B&W'})`,
                        cleanedPhone
                    );

                    session.paymentLink = paymentLinkObj.short_url;

                    return `Got it! Your total is ₹${session.price}.\nPlease pay here to confirm your job: ${session.paymentLink}\n\nWe will start printing once payment is confirmed.`;
                } catch (error) {
                    this.logger.error(`Error creating Razorpay payment link: ${error.message}`);
                    return 'Sorry, there was an issue generating your payment link. Please try again later.';
                }
            }
            return 'Please specify preferences clearly: [copies], [bw/color], [single/double]';
        }

        // Phase 3: Awaiting payment via Razorpay
        if (session.step === 'AWAITING_PAYMENT') {
            return `We are waiting for your payment of ₹${session.price} to be confirmed. Please check the link: ${session.paymentLink}`;
        }

        return 'How can I help you?';
    }

    /**
     * Helper function potentially used by Payment Module to confirm job printing
     */
    async tellStudentJobIsPrinting(sender: string): Promise<boolean> {
        this.logger.log(`Telling student (${sender}) that job is printing...`);

        // Format sender correctly in case Razorpay/PaymentService stripped the 'whatsapp:' prefix
        const to = sender.includes('whatsapp:') ? sender : `whatsapp:${sender}`;

        // Reset session after payment
        this.userSessions.delete(to);

        try {
            const fromNumber = process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886'; // default Twilio sandbox number

            await this.twilioClient.messages.create({
                body: "✅ Payment Confirmed! Your files have been sent to the printer.",
                from: fromNumber,
                to: to
            });
            this.logger.log(`Successfully sent confirmation via Twilio to ${to}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send WhatsApp confirmation via Twilio. Check Twilio credentials. Error: ${error.message}`);
            return false;
        }
    }
}
