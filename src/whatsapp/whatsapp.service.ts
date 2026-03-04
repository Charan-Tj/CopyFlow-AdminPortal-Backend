import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RazorpayService } from '../payments/razorpay/razorpay.service';
import * as twilio from 'twilio';
import axios from 'axios';
import * as mammoth from 'mammoth';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
const pdfParse = require('pdf-parse');

interface ChatState {
    step: 'AWAITING_FILE' | 'AWAITING_COPIES' | 'AWAITING_COLOR' | 'AWAITING_SIDES' | 'AWAITING_PAYMENT';
    fileUrl?: string;
    pages?: number;
    copies?: number;
    color?: boolean;
    sides?: 'single' | 'double';
    price?: number;
    paymentLink?: string;
    jobId?: string;
    sender?: string;
}

@Injectable()
export class WhatsappService implements OnModuleInit {
    private readonly logger = new Logger(WhatsappService.name);

    private userSessions = new Map<string, ChatState>();
    private twilioClient: twilio.Twilio;

    private copiesTemplateSid: string;
    private colorTemplateSid: string;
    private sidesTemplateSid: string;

    constructor(
        private readonly razorpayService: RazorpayService,
        private readonly supabaseStorage: SupabaseStorageService
    ) { }

    async onModuleInit() {
        await this.initTemplates();
    }

    private getTwilioClient(): twilio.Twilio {
        require('dotenv').config();
        return new twilio.Twilio(
            process.env.TWILIO_ACCOUNT_SID || 'ACtest',
            process.env.TWILIO_AUTH_TOKEN || 'testtoken'
        );
    }

    private async initTemplates() {
        const client = this.getTwilioClient();
        try {
            const contents = await client.content.v1.contents.list();

            const copies = contents.find(c => c.friendlyName === 'cf_copies_list');
            if (copies) {
                this.copiesTemplateSid = copies.sid;
            } else {
                const newTpl = await client.content.v1.contents.create({
                    friendlyName: 'cf_copies_list',
                    language: 'en',
                    types: {
                        'twilio/list-picker': {
                            body: 'How many copies of this document would you like?',
                            button: 'Select Copies',
                            items: [
                                { id: 'copies_1', item: '1 Copy', description: 'One copy' },
                                { id: 'copies_2', item: '2 Copies', description: 'Two copies' },
                                { id: 'copies_3', item: '3 Copies', description: 'Three copies' },
                                { id: 'copies_other', item: 'Other', description: 'A different amount' }
                            ]
                        }
                    } as any
                });
                this.copiesTemplateSid = newTpl.sid;
            }

            const color = contents.find(c => c.friendlyName === 'cf_color_quickrep');
            if (color) {
                this.colorTemplateSid = color.sid;
            } else {
                const newTpl = await client.content.v1.contents.create({
                    friendlyName: 'cf_color_quickrep',
                    language: 'en',
                    types: {
                        'twilio/quick-reply': {
                            body: 'What type of print do you want?',
                            actions: [
                                { id: 'bw', title: 'Black & White ₹2/page'.substring(0, 20) }, // Prevent > 20 chars Whatsapp restriction
                                { id: 'color', title: 'Color ₹10/page' }
                            ]
                        }
                    } as any
                });
                this.colorTemplateSid = newTpl.sid;
            }

            const sides = contents.find(c => c.friendlyName === 'cf_sides_quickrep');
            if (sides) {
                this.sidesTemplateSid = sides.sid;
            } else {
                const newTpl = await client.content.v1.contents.create({
                    friendlyName: 'cf_sides_quickrep',
                    language: 'en',
                    types: {
                        'twilio/quick-reply': {
                            body: 'Would you like single-sided or double-sided printing?',
                            actions: [
                                { id: 'single', title: 'Single Sided' },
                                { id: 'double', title: 'Double Sided' }
                            ]
                        }
                    } as any
                });
                this.sidesTemplateSid = newTpl.sid;
            }

            this.logger.log('Twilio Content API Templates initialized successfully.');
        } catch (e) {
            this.logger.error(`Failed to init templates: ${e.message}`);
            // Sometimes free/test accounts cant use content API fully, suppress error
        }
    }

    private async sendContentMessage(to: string, contentSid: string, variables: any = {}) {
        if (!contentSid) {
            this.logger.error('Content SID is not available. Ensure Twilio templates initialized properly.');
            await this.sendTextMessage(to, "Please select an option. (Interactive menus are currently unavailable, reply manually instead)");
            return;
        }

        const client = this.getTwilioClient();
        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
        const from = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;

        await client.messages.create({
            contentSid: contentSid,
            from,
            contentVariables: JSON.stringify(variables),
            to: to.includes('whatsapp:') ? to : `whatsapp:${to}`,
        });
    }

    private async sendTextMessage(to: string, body: string) {
        const client = this.getTwilioClient();
        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
        const from = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;

        await client.messages.create({
            body,
            from,
            to: to.includes('whatsapp:') ? to : `whatsapp:${to}`,
        });
    }

    /**
     * Sends a WhatsApp Typing indicator. 
     * Since native Twilio SDK doesn't wrap whatsapp sender-actions smoothly, we fire an raw HTTP POST to Twilio Messages API
     * https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators
     */
    private async sendTypingIndicator(to: string) {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) return;

        const auth = Buffer.from(`${sid}:${token}`).toString('base64');
        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';

        const fromParam = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;
        const toParam = to.includes('whatsapp:') ? to : `whatsapp:${to}`;

        try {
            const formData = new URLSearchParams();
            formData.append('To', toParam);
            formData.append('From', fromParam);
            // 'typing_on' tells Facebook/Meta graph to display the ... to the user
            formData.append('MessagingBinding.Action', 'typing_on');

            await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, formData, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                validateStatus: null // Suppress crashing on limits secretly
            });
        } catch (err) {
            this.logger.debug(`Failed to send typing indicator: ${err.message}`);
        }
    }

    private async getPageCount(mediaUrl: string, mediaContentType?: string): Promise<{ pages: number; supabaseUrl?: string; bufferLocation?: string; }> {
        try {
            const sid = process.env.TWILIO_ACCOUNT_SID;
            const token = process.env.TWILIO_AUTH_TOKEN;
            const auth = Buffer.from(`${sid}:${token}`).toString('base64');

            const response = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                headers: sid && token ? { 'Authorization': `Basic ${auth}` } : {},
                validateStatus: null // Capture all HTTP errors
            });

            if (response.status !== 200) {
                this.logger.error(`Failed to download Twilio media: HTTP ${response.status}`);
                return { pages: 1 };
            }

            const buffer = Buffer.from(response.data);
            const mime = (mediaContentType || response.headers['content-type'] || 'application/octet-stream').toLowerCase();

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

    async handleIncomingMessage(sender: string, message: string, mediaUrl?: string, mediaContentType?: string): Promise<string | null> {
        this.logger.log(`Received message from ${sender}: ${message}`);

        let session = this.userSessions.get(sender);

        if (!session) {
            session = { step: 'AWAITING_FILE' };
            this.userSessions.set(sender, session);
        }

        const normalizedMessage = message.trim().toLowerCase();

        try {
            if (session.step === 'AWAITING_FILE') {
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

                    session.step = 'AWAITING_COPIES';
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, this.copiesTemplateSid);
                    return null;
                }

                // If it's the very first message
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, 'Welcome to CopyFlow! Please send a file (PDF/Word/image) to get started.');
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
                await this.sendContentMessage(sender, this.colorTemplateSid);
                return null;
            }

            if (session.step === 'AWAITING_COLOR') {
                if (normalizedMessage.includes('color') || message === 'color') {
                    session.color = true;
                } else if (normalizedMessage.includes('black') || normalizedMessage.includes('b&w') || message === 'bw') {
                    session.color = false;
                } else {
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, this.colorTemplateSid);
                    return null;
                }

                session.step = 'AWAITING_SIDES';
                await this.sendTypingIndicator(sender);
                await this.sendContentMessage(sender, this.sidesTemplateSid);
                return null;
            }

            if (session.step === 'AWAITING_SIDES') {
                if (normalizedMessage.includes('double') || message === 'double') {
                    session.sides = 'double';
                } else if (normalizedMessage.includes('single') || message === 'single') {
                    session.sides = 'single';
                } else {
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, this.sidesTemplateSid);
                    return null;
                }

                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;

                session.step = 'AWAITING_PAYMENT';

                try {
                    this.logger.log(`Starting to create Razorpay link. Price: ${session.price}, Color: ${session.color}, Sides: ${session.sides}`);
                    const referenceId = `wa_${Date.now()}`;
                    session.jobId = referenceId;
                    session.sender = sender;
                    const cleanedPhone = sender.replace('whatsapp:', '');
                    this.logger.log(`Cleaned phone: ${cleanedPhone}`);

                    await this.sendTypingIndicator(sender);
                    this.logger.log('Creating payment link via razorpayService...');
                    const isColorStr = session.color ? 'Color' : 'Black and White';
                    const paymentLinkObj = await this.razorpayService.createPaymentLink(
                        session.price,
                        referenceId,
                        `Print job (${session.copies || 1}x ${session.sides} ${isColorStr})`,
                        cleanedPhone
                    );
                    this.logger.log(`Created payment link: ${paymentLinkObj.short_url}`);

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
                return null;
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
        } catch (globalError) {
            // If ANY twilio API call fails because of rate limiting
            const errStr = globalError as any;
            if (errStr && errStr.code === 63038) {
                this.logger.warn(`WhatsApp Rate limit hit inside function. Attempting TwiML response fallback`);
                return "Twilio API Limit reached. (Please wait or use another account).";
            }
            throw globalError;
        }
    }

    getSession(sender: string): ChatState | undefined {
        const to = sender.includes('whatsapp:') ? sender : `whatsapp:${sender}`;
        return this.userSessions.get(to) || this.userSessions.get(sender);
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
            this.logger.log(`Successfully sent confirmation via Twilio to ${to}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send WhatsApp confirmation via Twilio. Check Twilio credentials. Error: ${error.message}`);
            return false;
        }
    }
}
