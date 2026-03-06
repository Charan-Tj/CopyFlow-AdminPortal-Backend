import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { RazorpayService } from '../payment/razorpay/razorpay.service';
import axios from 'axios';
import * as mammoth from 'mammoth';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
const pdfParse = require('pdf-parse');

interface UploadedFile {
    url: string;
    pages: number;
    name: string;
}

interface ChatState {
    step: 'AWAITING_FILE' | 'AWAITING_COPIES' | 'AWAITING_COLOR' | 'AWAITING_SIDES' | 'AWAITING_PAYMENT' | 'AWAITING_FLOW';
    nodeId?: string;
    nodeCode?: string;
    files: UploadedFile[];
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

    private async sendTypingIndicator(to: string) {
        await this.whatsappProvider.sendTypingIndicator(to);
    }

    private async getPageCount(mediaUrl: string, mediaContentType?: string): Promise<{ pages: number; supabaseUrl?: string; fileName?: string }> {
        try {
            const buffer = await this.whatsappProvider.downloadMedia(mediaUrl);
            const mime = (mediaContentType || 'application/octet-stream').toLowerCase();

            let supabaseUrl: string | undefined;
            let fileName: string | undefined;
            try {
                const extension = mime.includes('pdf') ? 'pdf' : (mime.includes('word') ? 'docx' : 'bin');
                fileName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
                supabaseUrl = await this.supabaseStorage.uploadFile(buffer, fileName, mime);
            } catch (storageErr) {
                this.logger.warn(`Failed to upload to Supabase: ${storageErr.message}`);
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

            return { pages, supabaseUrl, fileName };
        } catch (error) {
            this.logger.error(`Failed to parse pages, defaulting to 1: ${error.message}`);
            return { pages: 1 };
        }
    }

    async handleIncomingMessage(sender: string, message: string, mediaUrl?: string, mediaContentType?: string, interactiveData?: any): Promise<string | null> {
        this.logger.log(`Received message from ${sender}: ${message}`);

        let session = this.userSessions.get(sender);

        if (!session) {
            session = { step: 'AWAITING_FILE', files: [], startedAt: Date.now() };
            this.userSessions.set(sender, session);
        }

        const normalizedMessage = message.trim().toLowerCase();

        try {
            // Handle InteractiveData for AWAITING_FLOW
            if (interactiveData && session.step === 'AWAITING_FLOW') {
                this.logger.log(`Received Interactive Flow Response: ${JSON.stringify(interactiveData)}`);
                const flowInput = interactiveData.data || {};
                session.copies = flowInput.copies ? parseInt(flowInput.copies, 10) : 1;
                session.color = flowInput.color === 'true' || flowInput.color === true;
                session.sides = flowInput.sides === 'double' ? 'double' : 'single';
                session.step = 'AWAITING_SIDES';
                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;
                session.step = 'AWAITING_PAYMENT';
                return await this.createRazorpayLinkAndNotify(session, sender, pricePerPage);
            }

            // Fallback for AWAITING_FLOW on non-Meta channels
            if (session.step === 'AWAITING_FLOW' && !interactiveData) {
                if (normalizedMessage === 'reset' || normalizedMessage === 'start') {
                    session.step = 'AWAITING_FILE';
                    session.useFlow = false;
                    session.files = [];
                    await this.sendTextMessage(sender, "Session reset. Please send your document.");
                    return null;
                }
                session.step = 'AWAITING_COPIES';
                await this.sendTextMessage(sender, "Since you are in text mode, let's continue with manual settings.");
                await this.sendContentMessage(sender, 'cf_copies_list');
                return null;
            }

            // ═══════════════════════════════════════════
            // AWAITING_FILE — supports multiple file uploads
            // ═══════════════════════════════════════════
            if (session.step === 'AWAITING_FILE') {
                // Handle QR code start command
                if (normalizedMessage.startsWith('start ')) {
                    const qrToken = normalizedMessage.split(' ')[1];
                    const node = await this.prisma.node.findUnique({
                        where: { qr_token: qrToken }
                    });
                    if (node) {
                        session.nodeId = node.id;
                        session.nodeCode = node.node_code;
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, `Welcome to CopyFlow @ ${node.name}! Please send your files (PDF/Word/image) to get started.`);
                    } else {
                        await this.sendTextMessage(sender, "Invalid or expired QR code. Please scan a valid shop QR code.");
                    }
                    return null;
                }

                if (normalizedMessage === 'hi-flow') {
                    session.useFlow = true;
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, "Interactive Flow mode activated! Please upload your documents to begin.");
                    return null;
                }

                // User taps "Done" — move to copies selection
                if (normalizedMessage === 'done' || normalizedMessage === 'done_uploading') {
                    if (session.files.length === 0) {
                        await this.sendTextMessage(sender, "You haven't uploaded any files yet. Please send a file first.");
                        return null;
                    }

                    // Calculate total pages
                    session.pages = session.files.reduce((sum, f) => sum + f.pages, 0);

                    if (session.useFlow) {
                        session.step = 'AWAITING_FLOW';
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, "Please open the Interactive Print Form, select your settings, and submit.");
                        return null;
                    }

                    session.step = 'AWAITING_COPIES';
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_copies_list');
                    return null;
                }

                // User sends a file
                if (mediaUrl) {
                    await this.sendTypingIndicator(sender);
                    const fileNum = session.files.length + 1;
                    await this.sendTextMessage(sender, `📄 Analyzing file ${fileNum}...`);

                    await this.sendTypingIndicator(sender);
                    const { pages, supabaseUrl, fileName } = await this.getPageCount(mediaUrl, mediaContentType);

                    const fileEntry: UploadedFile = {
                        url: supabaseUrl || mediaUrl,
                        pages,
                        name: fileName || `file_${fileNum}`,
                    };
                    session.files.push(fileEntry);

                    const totalPages = session.files.reduce((sum, f) => sum + f.pages, 0);
                    const fileCount = session.files.length;

                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_file_uploaded', {
                        fileNum,
                        pages,
                        totalPages,
                        fileCount,
                    });
                    return null;
                }

                // First message — welcome
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, 'Welcome to CopyFlow! 🖨️\n\nSend your files (PDF/Word/image) to get started.\nYou can send multiple files — tap "Done" when finished.');
                    return null;
                } catch (err) {
                    this.logger.error(`Send error: ${err.message}`);
                    return 'Welcome to CopyFlow! Send your files (PDF/Word/image) to get started.';
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
            const fileCount = session.files.length;
            const description = `Print job (${fileCount} file${fileCount > 1 ? 's' : ''}, ${session.copies || 1}x ${session.sides} ${isColorStr})`;

            const paymentLinkObj = await this.razorpayService.createPaymentLink(
                session.price as number,
                referenceId,
                description,
                cleanedPhone
            );

            session.paymentLink = paymentLinkObj.short_url;

            const filesText = fileCount > 1 ? `${fileCount} files, ${session.pages || 1} total pages` : `${session.pages || 1} pages`;
            const msg = `📋 Order Summary:\n• ${filesText}\n• ${session.copies || 1} copies × ${session.sides}-sided\n• ${isColorStr} @ ₹${pricePerPage}/page\n\n💰 Total: ₹${session.price}\n\n🔗 Pay here: ${session.paymentLink}\n\nWe will start printing once payment is confirmed.`;
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
        const session = this.userSessions.get(to) || this.userSessions.get(sender);

        // Cleanup ALL uploaded files from Supabase
        if (session && session.files && session.files.length > 0) {
            for (const file of session.files) {
                if (file.url && file.url.includes('supabase.co')) {
                    try {
                        const urlParts = file.url.split('/');
                        const filename = urlParts[urlParts.length - 1];
                        if (filename) {
                            await this.supabaseStorage.deleteFile(filename);
                            this.logger.log(`Cleaned up Supabase file: ${filename}`);
                        }
                    } catch (e) {
                        this.logger.warn(`Failed to cleanup file ${file.name}: ${e.message}`);
                    }
                }
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
