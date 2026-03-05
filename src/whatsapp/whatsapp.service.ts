import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import axios from 'axios';
import * as mammoth from 'mammoth';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
const pdfParse = require('pdf-parse');

interface ChatState {
    step: 'AWAITING_FILE' | 'AWAITING_COPIES' | 'AWAITING_COLOR' | 'AWAITING_SIDES' | 'AWAITING_PAYMENT' | 'AWAITING_FLOW';
    nodeId?: string;
    nodeCode?: string;
    fileUrl?: string;
    pages?: number;
    copies?: number;
    color?: boolean;
    sides?: 'single' | 'double';
    price?: number;
    paymentLink?: string;
    jobId?: string;
    sender?: string;
    useFlow?: boolean;
    startedAt?: number;
}

@Injectable()
export class WhatsappService {
    private readonly logger = new Logger(WhatsappService.name);

    private userSessions = new Map<string, ChatState>();

    constructor(
        @Inject(forwardRef(() => RazorpayService)) private readonly razorpayService: RazorpayService,
        private readonly supabaseStorage: SupabaseStorageService,
        private readonly prisma: PrismaService,
        @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: WhatsappProvider
    ) { }

    private async sendContentMessage(to: string, contentSid: string, variables: any = {}) {
        await this.whatsappProvider.sendContentMessage(to, contentSid, variables);
    }

    private async sendTextMessage(to: string, body: string) {
        await this.whatsappProvider.sendTextMessage(to, body);
    }

    /**
     * Sends a WhatsApp Typing indicator via the provider abstraction
     */
    private async sendTypingIndicator(to: string) {
        await this.whatsappProvider.sendTypingIndicator(to);
    }

    private async getPageCount(mediaUrl: string, mediaContentType?: string): Promise<{ pages: number; supabaseUrl?: string; bufferLocation?: string; }> {
        try {
            const buffer = await this.whatsappProvider.downloadMedia(mediaUrl);
            const mime = (mediaContentType || 'application/octet-stream').toLowerCase();

            // Upload immediately to Supabase
            let supabaseUrl: string | undefined;
            try {
                // generate a reasonably unique filename for storage
                const extension = mime.includes('pdf') ? 'pdf' : (mime.includes('word') ? 'docx' : 'bin');
                const filename = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;

                supabaseUrl = await this.supabaseStorage.uploadFile(buffer, filename, mime);
            } catch (storageErr) {
                this.logger.warn(`Failed to upload to Supabase, processing will continue locally: ${storageErr.message}`);
            }

            let pages = 1;
            if (mime.includes('pdf')) {
                const data = await pdfParse(buffer);
                pages = data.numpages || 1;
            } else if (mime.includes('word') || mime.includes('document')) {
                const result = await mammoth.extractRawText({ buffer });
                const wordCount = result.value.split(/\s+/).filter(w => w.length > 0).length;
                pages = Math.max(1, Math.ceil(wordCount / 250));
            } else if (mime.includes('image')) {
                pages = 1;
            }

            return { pages, supabaseUrl, bufferLocation: supabaseUrl }; // keep object flexible
        } catch (error) {
            this.logger.error(`Failed to parse pages, defaulting to 1: ${error.message}`);
            return { pages: 1 };
        }
    }

    async handleIncomingMessage(sender: string, message: string, mediaUrl?: string, mediaContentType?: string, interactiveData?: any): Promise<string | null> {
        this.logger.log(`Received message from ${sender}: ${message}`);

        let session = this.userSessions.get(sender);

        if (!session) {
            session = { step: 'AWAITING_FILE', startedAt: Date.now() };
            this.userSessions.set(sender, session);
        }

        const normalizedMessage = message.trim().toLowerCase();

        try {
            // Check for InteractiveData payload first
            if (interactiveData && session.step === 'AWAITING_FLOW') {
                this.logger.log(`Received Interactive Flow Response: ${JSON.stringify(interactiveData)}`);

                // Assuming interactiveData looks like: { data: { copies: "2", color: "false", sides: "double" } }
                const flowInput = interactiveData.data || {};
                session.copies = flowInput.copies ? parseInt(flowInput.copies, 10) : 1;
                session.color = flowInput.color === 'true' || flowInput.color === true;
                session.sides = flowInput.sides === 'double' ? 'double' : 'single';

                // Skip ahead directly to AWAITING_SIDES processing logic to generate payment link cleanly
                session.step = 'AWAITING_SIDES';
                // Jump to that block immediately by omitting the 'return null' here
                // We'll actually construct a helper call or just let it fall through 
                // Wait, it is cleaner to just run the pricing math here manually rather than falling through.
                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;

                session.step = 'AWAITING_PAYMENT';
                return await this.createRazorpayLinkAndNotify(session, sender, pricePerPage);
            }

            // Fallback for AWAITING_FLOW if no interactiveData (e.g. testing on Telegram)
            if (session.step === 'AWAITING_FLOW' && !interactiveData) {
                // Return to normal flow or handle specific commands
                if (normalizedMessage === 'reset' || normalizedMessage === 'start') {
                    session.step = 'AWAITING_FILE';
                    session.useFlow = false;
                    await this.sendTextMessage(sender, "Session reset. Please send your document.");
                    return null;
                }

                // If they just type something, send them back to the list-based questions
                // to avoid being permanently stuck in AWAITING_FLOW on non-Meta channels.
                session.step = 'AWAITING_COPIES';
                await this.sendTextMessage(sender, "Since you are in text mode, let's continue with manual settings.");
                await this.sendContentMessage(sender, 'cf_copies_list');
                return null;
            }

            if (session.step === 'AWAITING_FILE') {
                if (normalizedMessage.startsWith('start ')) {
                    const qrToken = normalizedMessage.split(' ')[1];
                    const node = await this.prisma.node.findUnique({
                        where: { qr_token: qrToken }
                    });
                    if (node) {
                        session.nodeId = node.id;
                        session.nodeCode = node.node_code;
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, `Welcome to CopyFlow @ ${node.name}! Please send a file (PDF/Word/image) to get started.`);
                    } else {
                        await this.sendTextMessage(sender, "Invalid or expired QR code. Please scan a valid shop QR code.");
                    }
                    return null;
                }

                if (normalizedMessage === 'hi-flow') {
                    session.useFlow = true;
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, "Interactive Flow mode activated! Please upload your document to begin.");
                    return null;
                }

                if (mediaUrl) {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, "Analyzing your document...");

                    await this.sendTypingIndicator(sender);
                    const { pages, supabaseUrl } = await this.getPageCount(mediaUrl, mediaContentType);

                    session.pages = pages;
                    // Replace the Twilio mediaUrl format with our permanent Supabase URL
                    if (supabaseUrl) {
                        session.fileUrl = supabaseUrl;
                    } else {
                        session.fileUrl = mediaUrl; // Fallback to raw Twilio URL if upload fails
                    }

                    if (session.useFlow) {
                        session.step = 'AWAITING_FLOW';
                        await this.sendTypingIndicator(sender);
                        // Send the interactive flow template/prompt here. 
                        // Note: For Twilio Sandbox without a configured meta template, this is just a simulated instruction.
                        await this.sendTextMessage(sender, "Please open the Interactive Print Form that normally appears here, select your settings, and submit.");
                        // NATIVE WhatsApp FLow API Template: await this.sendContentMessage(sender, 'cf_native_flow_template');
                        return null;
                    }

                    session.step = 'AWAITING_COPIES';
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_copies_list');
                    return null;
                }

                // If it's the very first message
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, 'Welcome to CopyFlow! Please send a file (PDF/Word/image) to get started. \n\n(Tip: Type "hi-flow" to enable the experimental WhatsApp Flow mode)');
                    return null;
                } catch (err) {
                    this.logger.error(`Hit Twilio Limit: ${err.message}. Falling back to normal XML.`);
                    return 'Welcome to CopyFlow! Please send a file (PDF/Word/image) to get started.';
                }
            }

            if (session.step === 'AWAITING_COPIES') {
                let copies = 1;
                if (normalizedMessage === 'other' || normalizedMessage === 'copies_other') {
                    try {
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, "Please type the number of copies you want:");
                        return null;
                    } catch (err) {
                        return "Please type the number of copies you want:";
                    }
                }

                const match = normalizedMessage.match(/\d+/);
                if (match) {
                    copies = parseInt(match[0], 10);
                } else if (normalizedMessage.includes('1 copy') || message === '1') copies = 1;
                else if (normalizedMessage.includes('2 copies') || message === '2') copies = 2;
                else if (normalizedMessage.includes('3 copies') || message === '3') copies = 3;
                else if (normalizedMessage === 'copies_1') copies = 1;
                else if (normalizedMessage === 'copies_2') copies = 2;
                else if (normalizedMessage === 'copies_3') copies = 3;

                session.copies = copies;
                session.step = 'AWAITING_COLOR';
                await this.sendTypingIndicator(sender);
                await this.sendContentMessage(sender, 'cf_color_quickrep');
                return null;
            }

            if (session.step === 'AWAITING_COLOR') {
                if (normalizedMessage.includes('color') || message === 'color') {
                    session.color = true;
                } else if (normalizedMessage.includes('black') || normalizedMessage.includes('b&w') || message === 'bw') {
                    session.color = false;
                } else {
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_color_quickrep');
                    return null;
                }

                session.step = 'AWAITING_SIDES';
                await this.sendTypingIndicator(sender);
                await this.sendContentMessage(sender, 'cf_sides_quickrep');
                return null;
            }

            if (session.step === 'AWAITING_SIDES') {
                if (normalizedMessage.includes('double') || message === 'double') {
                    session.sides = 'double';
                } else if (normalizedMessage.includes('single') || message === 'single') {
                    session.sides = 'single';
                } else {
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_sides_quickrep');
                    return null;
                }

                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;

                session.step = 'AWAITING_PAYMENT';
                return await this.createRazorpayLinkAndNotify(session, sender, pricePerPage);
            }

            if (session.step === 'AWAITING_PAYMENT') {
                const msg = `We are waiting for your payment of ₹${session.price} to be confirmed. Please check the link: ${session.paymentLink}`;
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, msg);
                    return null;
                } catch (err) {
                    return msg;
                }
            }

            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender, 'How can I help you?');
                return null;
            } catch (err) {
                return 'How can I help you?';
            }
        } catch (globalError: any) {
            this.logger.error(`Error processing message: ${globalError.message}`);
            // Let the caller (Bull queue processor) handle failures
            throw globalError;
        }
    }

    private async createRazorpayLinkAndNotify(session: ChatState, sender: string, pricePerPage: number): Promise<string | null> {
        try {
            this.logger.log(`Starting to create Razorpay link. Price: ${session.price}, Color: ${session.color}, Sides: ${session.sides}`);
            const referenceId = `wa_${Date.now()}`;
            session.jobId = referenceId;
            session.sender = sender;
            const cleanedPhone = sender.replace('whatsapp:', '');

            await this.sendTypingIndicator(sender);
            this.logger.log('Creating payment link via razorpayService...');
            const isColorStr = session.color ? 'Color' : 'Black and White';
            const paymentLinkObj = await this.razorpayService.createPaymentLink(
                session.price as number,
                referenceId,
                `Print job (${session.copies || 1}x ${session.sides} ${isColorStr})`,
                cleanedPhone
            );

            session.paymentLink = paymentLinkObj.short_url;

            const msg = `Your document has ${session.pages || 1} pages.\nTotal: ${session.pages || 1} pages x ${session.copies || 1} copies x Rs. ${pricePerPage} = Rs. ${session.price}\n\nPlease pay here to confirm your job: ${session.paymentLink}\n\nWe will start printing once payment is confirmed.`;
            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender, msg);
                return null;
            } catch (err) {
                return msg;
            }
        } catch (error: any) {
            const errorMsg = error?.error?.description || error?.message || 'Unknown Razorpay error';
            this.logger.error(`Error creating Razorpay payment link: ${errorMsg}`);
            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender, 'Sorry, there was an issue generating your payment link. Please try again later.');
                return null;
            } catch (err) {
                return 'Sorry, there was an issue generating your payment link. Please try again later.';
            }
        }
    }

    getSession(sender: string): ChatState | undefined {
        const to = sender.includes('whatsapp:') ? sender : `whatsapp:${sender}`;
        return this.userSessions.get(to) || this.userSessions.get(sender);
    }

    getSessions(): any[] {
        return Array.from(this.userSessions.entries()).map(([sender, state]) => ({
            sender,
            ...state
        }));
    }

    async tellStudentJobIsPrinting(sender: string): Promise<boolean> {
        this.logger.log(`Telling student (${sender}) that job is printing...`);

        const to = sender.includes('whatsapp:') ? sender : `whatsapp:${sender}`;

        // Grab session data before deleting it to extract file dependency
        const session = this.userSessions.get(to) || this.userSessions.get(sender);

        if (session && session.fileUrl && session.fileUrl.includes('supabase.co')) {
            // Delete the file from bucket as requested after printing
            try {
                // Extract filename from the end of the URL
                const urlParts = session.fileUrl.split('/');
                const filename = urlParts[urlParts.length - 1]; // E.g., upload_1234_abc.pdf

                if (filename) {
                    await this.supabaseStorage.deleteFile(filename);
                }
            } catch (e) {
                this.logger.warn(`Failed to cleanup Supabase File gracefully: ${e.message}`);
            }
        }

        this.userSessions.delete(to);

        try {
            await this.sendTextMessage(to, "✅ Payment Confirmed! Your files have been sent to the printer.");
            this.logger.log(`Successfully sent confirmation via WhatsApp to ${to}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send WhatsApp confirmation. Error: ${error.message}`);
            return false;
        }
    }
}
