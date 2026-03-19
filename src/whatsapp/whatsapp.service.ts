import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PhonepeService } from '../payment/phonepe/phonepe.service';
import { CashfreeService } from '../payment/cashfree/cashfree.service';
import axios from 'axios';
import * as mammoth from 'mammoth';
import { R2Service } from '../r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import { TelegramProvider } from './providers/telegram.provider';
import { MetaProvider } from './providers/meta.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { evaluateKioskStatus } from '../node/kiosk-status.util';
const pdfParse = require('pdf-parse');

interface UploadedFile {
    url: string;
    pages: number;
    name: string;
}

interface ChatState {
    step: 'AWAITING_FILE' | 'AWAITING_COPIES' | 'AWAITING_COLOR' | 'AWAITING_SIDES' | 'AWAITING_PAYMENT' | 'AWAITING_FLOW' | 'AWAITING_CONFIRMATION' | 'PAID' | 'PRINTED';
    nodeId?: string;
    nodeCode?: string;
    files: UploadedFile[];
    pages?: number;
    copies?: number;
    color?: boolean;
    sides?: 'single' | 'double';
    price?: number;
    paymentLink?: string;
    phonepeLink?: string;
    cashfreeLink?: string;
    jobId?: string;
    sender?: string;
    userName?: string;
    platform?: 'telegram' | 'meta' | 'twilio';
    useFlow?: boolean;
    startedAt?: number;
}

@Injectable()
export class WhatsappService {
    private readonly logger = new Logger(WhatsappService.name);

    // In-memory cache backed by DB persistence (ChatSession model)
    private sessionCache = new Map<string, ChatState>();

    constructor(
        @Inject(forwardRef(() => PhonepeService)) private readonly phonepeService: PhonepeService,
        @Inject(forwardRef(() => CashfreeService)) private readonly cashfreeService: CashfreeService,
        private readonly r2Storage: R2Service,
        private readonly prisma: PrismaService,
        private readonly telegramProvider: TelegramProvider,
        private readonly metaProvider: MetaProvider,
        private readonly twilioProvider: TwilioProvider
    ) { }

    /**
     * Route to the correct provider based on sender prefix.
     * telegram:xxx  → TelegramProvider
     * whatsapp:xxx  → MetaProvider (or Twilio, based on env)
     * fallback      → MetaProvider
     */
    private resolveProvider(sender: string): WhatsappProvider {
        if (sender.startsWith('telegram:')) {
            return this.telegramProvider;
        }
        // For whatsapp: senders, pick meta or twilio based on env
        const whatsappBackend = process.env.WHATSAPP_PROVIDER || 'meta';
        if (whatsappBackend === 'twilio') {
            return this.twilioProvider;
        }
        return this.metaProvider;
    }

    // ─── Session persistence helpers ─────────────────────────────────

    private async loadSession(sender: string): Promise<ChatState | undefined> {
        // Check cache first
        const cached = this.sessionCache.get(sender);
        if (cached) return cached;

        // Fall back to DB
        const row = await this.prisma.chatSession.findUnique({ where: { sender } });
        if (!row) return undefined;

        const session = row.data as unknown as ChatState;
        this.sessionCache.set(sender, session);
        return session;
    }

    private async saveSession(sender: string, session: ChatState): Promise<void> {
        this.sessionCache.set(sender, session);
        await this.prisma.chatSession.upsert({
            where: { sender },
            update: {
                data: session as any,
                job_id: session.jobId || null,
                node_id: session.nodeId || null,
            },
            create: {
                sender,
                data: session as any,
                job_id: session.jobId || null,
                node_id: session.nodeId || null,
            },
        });
    }

    private async deleteSession(sender: string): Promise<void> {
        this.sessionCache.delete(sender);
        await this.prisma.chatSession.deleteMany({ where: { sender } });
    }

    async updateSessionStep(sender: string, newStep: 'PAID' | 'PRINTED'): Promise<void> {
        const session = await this.loadSession(sender);
        if (session) {
            session.step = newStep;
            await this.saveSession(sender, session);
        }
    }

    /**
     * Look up session by jobId (reference_id from payment link providers).
     * Used by PaymentService when phone-based lookup fails.
     */
    async getSessionByJobId(jobId: string): Promise<{ sender: string; session: ChatState } | undefined> {
        // Check cache first
        for (const [sender, session] of this.sessionCache.entries()) {
            if (session.jobId === jobId) return { sender, session };
        }
        // Fall back to DB
        const row = await this.prisma.chatSession.findFirst({ where: { job_id: jobId } });
        if (!row) return undefined;
        const session = row.data as unknown as ChatState;
        this.sessionCache.set(row.sender, session);
        return { sender: row.sender, session };
    }

    /**
     * Assign a default active node if no nodeId has been set.
     * Picks the first active node in the database.
     */
    private async ensureNodeId(session: ChatState): Promise<void> {
        if (session.nodeId) return;

        const defaultNode = await this.prisma.node.findFirst({
            where: { is_active: true },
            orderBy: { created_at: 'asc' },
        });

        if (defaultNode) {
            session.nodeId = defaultNode.id;
            session.nodeCode = defaultNode.node_code;
            this.logger.warn(`No nodeId on session — auto-assigned default node "${defaultNode.name}" (${defaultNode.id})`);
        } else {
            this.logger.error('No active nodes in the database — cannot assign a default node');
        }
    }

    private async getNodeKioskStatusSnapshot(nodeId: string, nodeCode?: string) {
        const kiosk = await this.prisma.kiosk.findFirst({
            where: { node_id: nodeId },
            orderBy: { updatedAt: 'desc' }
        });

        return evaluateKioskStatus(kiosk, undefined, nodeCode);
    }

    private async sendContentMessage(to: string, contentSid: string, variables: any = {}) {
        await this.resolveProvider(to).sendContentMessage(to, contentSid, variables);
    }

    async sendTextMessage(to: string, body: string) {
        await this.resolveProvider(to).sendTextMessage(to, body);
    }

    private async sendTypingIndicator(to: string) {
        await this.resolveProvider(to).sendTypingIndicator(to);
    }

    /**
     * Derive a proper file extension from a MIME type.
     * Bug 3 fix: images were previously stored as .bin.
     */
    private mimeToExtension(mime: string): string {
        if (mime.includes('pdf')) return 'pdf';
        if (mime.includes('word') || mime.includes('document')) return 'docx';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if (mime.includes('png')) return 'png';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('tiff')) return 'tiff';
        if (mime.includes('bmp')) return 'bmp';
        if (mime.includes('svg')) return 'svg';
        // Fallback — use the subtype portion of the MIME if available
        const parts = mime.split('/');
        return parts.length > 1 ? parts[1].split(';')[0] : 'bin';
    }

    private async getPageCount(sender: string, mediaUrl: string, mediaContentType?: string): Promise<{ pages: number; supabaseUrl?: string; fileName?: string }> {
        try {
            const buffer = await this.resolveProvider(sender).downloadMedia(mediaUrl);
            const mime = (mediaContentType || 'application/octet-stream').toLowerCase();

            let supabaseUrl: string | undefined;
            let fileName: string | undefined;
            try {
                const extension = this.mimeToExtension(mime);
                fileName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
                supabaseUrl = await this.r2Storage.uploadFile(fileName, buffer, mime);
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

    async handleIncomingMessage(sender: string, message: string, mediaUrl?: string, mediaContentType?: string, interactiveData?: any, userName?: string): Promise<string | null> {
        this.logger.log(`Received message from ${sender}: ${message}`);

        let session = await this.loadSession(sender);

        if (!session) {
            session = { step: 'AWAITING_FILE', files: [], startedAt: Date.now(), userName: String(userName || '').trim() || undefined };
            await this.saveSession(sender, session);
        } else if (String(userName || '').trim() && !session.userName) {
            session.userName = String(userName || '').trim();
            await this.saveSession(sender, session);
        }

        const normalizedMessage = message.trim().toLowerCase();

        try {
            // ─── Help command ───────────────
            if (normalizedMessage === 'help' || normalizedMessage === '/help') {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender,
                    '📖 *CopyFlow Help*\n\n' +
                    '🖨️ *How to print:*\n' +
                    '1. Send your files (PDF/Word/image)\n' +
                    '2. Tap "Done" when finished uploading\n' +
                    '3. Select copies, color, and sides\n' +
                    '4. Pay via the payment link\n' +
                    '5. Your files are printed automatically!\n\n' +
                    '📋 *Commands:*\n' +
                    '/start — Start a new print session\n' +
                    '/shops — List available print shops\n' +
                    '/cancel — Cancel current session\n' +
                    '/reset — Reset and start over\n' +
                    '/help — Show this help message\n\n' +
                    '🏪 *Shop selection:*\n' +
                    'Type: shop <code> to select a shop\n' +
                    'Example: shop TESTNODE1'
                );
                return null;
            }

            // ─── Global cancel/reset: works at ANY step ───────────────
            if (normalizedMessage === 'cancel' || normalizedMessage === 'reset' || normalizedMessage === 'restart' || normalizedMessage === '/cancel' || normalizedMessage === '/reset' || normalizedMessage === '/start') {
                await this.deleteSession(sender);
                session = { step: 'AWAITING_FILE', files: [], startedAt: Date.now(), userName: String(userName || '').trim() || undefined };
                await this.saveSession(sender, session);
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender, '🔄 Session reset! Send your files (PDF/Word/image) to start a new print job.\n\nTo select a shop, type: shop <shop_code>');
                return null;
            }

            // ─── Global shop selection: works at ANY step ───────────────
            if (normalizedMessage.startsWith('shop ')) {
                const shopCode = message.trim().split(/\s+/)[1]?.toUpperCase();
                if (!shopCode) {
                    await this.sendTextMessage(sender, '❓ Please type: shop <shop_code>\nExample: shop TESTNODE1');
                    return null;
                }

                const node = await this.prisma.node.findFirst({
                    where: {
                        node_code: { equals: shopCode, mode: 'insensitive' },
                        is_active: true,
                    },
                });

                if (node) {
                    session.nodeId = node.id;
                    session.nodeCode = node.node_code;
                    await this.saveSession(sender, session);
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, `✅ Selected shop: ${node.name} (${node.node_code})\n${node.college}, ${node.city}\n\nYou can now send your files to print.`);
                } else {
                    // List available shops
                    const activeNodes = await this.prisma.node.findMany({
                        where: { is_active: true },
                        select: { node_code: true, name: true, college: true, city: true },
                        take: 10,
                    });

                    let msg = `❌ Shop code "${shopCode}" not found.`;
                    if (activeNodes.length > 0) {
                        msg += '\n\n📍 Available shops:';
                        for (const n of activeNodes) {
                            msg += `\n• ${n.node_code} — ${n.name} (${n.college}, ${n.city})`;
                        }
                        msg += '\n\nType: shop <code> to select one.';
                    }
                    await this.sendTextMessage(sender, msg);
                }
                return null;
            }

            // ─── List shops command ───────────────
            if (normalizedMessage === 'shops' || normalizedMessage === '/shops') {
                const activeNodes = await this.prisma.node.findMany({
                    where: { is_active: true },
                    select: { node_code: true, name: true, college: true, city: true },
                    take: 10,
                });

                if (activeNodes.length === 0) {
                    await this.sendTextMessage(sender, '😕 No shops are currently available.');
                } else {
                    let msg = '📍 Available shops:';
                    for (const n of activeNodes) {
                        msg += `\n• ${n.node_code} — ${n.name} (${n.college}, ${n.city})`;
                    }
                    msg += '\n\nType: shop <code> to select one.';
                    if (session.nodeId) {
                        msg += `\n\n✅ Currently selected: ${session.nodeCode}`;
                    }
                    await this.sendTextMessage(sender, msg);
                }
                return null;
            }

            // If previous job is already completed, transparently start a fresh session.
            // Keep selected shop so repeat users can send the next file immediately.
            if (session.step === 'PAID' || session.step === 'PRINTED') {
                const preservedNodeId = session.nodeId;
                const preservedNodeCode = session.nodeCode;
                const preservedPlatform = session.platform;
                const preservedUserName = session.userName;

                session = {
                    step: 'AWAITING_FILE',
                    files: [],
                    startedAt: Date.now(),
                    nodeId: preservedNodeId,
                    nodeCode: preservedNodeCode,
                    platform: preservedPlatform,
                    userName: preservedUserName,
                };
                await this.saveSession(sender, session);

                if (!mediaUrl && normalizedMessage !== 'done' && normalizedMessage !== 'done_uploading') {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(
                        sender,
                        `✅ Previous order completed. Send your next file to start a new print job.${preservedNodeCode ? `\n🏪 Shop: ${preservedNodeCode}` : ''}`,
                    );
                    return null;
                }
            }

            // Handle InteractiveData for AWAITING_FLOW (Meta NFM form submission)
            if (interactiveData && session.step === 'AWAITING_FLOW') {
                this.logger.log(`Received Interactive Flow Response: ${JSON.stringify(interactiveData)}`);
                const flowInput = interactiveData.data || {};
                session.copies = flowInput.copies ? parseInt(flowInput.copies, 10) : 1;
                session.color = flowInput.color === 'true' || flowInput.color === true;
                session.sides = flowInput.sides === 'double' ? 'double' : 'single';
                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;
                session.step = 'AWAITING_CONFIRMATION';
                await this.saveSession(sender, session);
                const summary = this.generateOrderSummary(session, pricePerPage);
                await this.sendContentMessage(sender, 'cf_order_confirm', { summary });
                return null;
            }

            // Stuck in AWAITING_FLOW without interactiveData (shouldn't happen but just in case)
            // — transition to standard copies flow
            if (session.step === 'AWAITING_FLOW' && !interactiveData) {
                this.logger.warn(`${sender} stuck in AWAITING_FLOW without interactiveData — transitioning to AWAITING_COPIES`);
                session.step = 'AWAITING_COPIES';
                await this.saveSession(sender, session);
                await this.sendTypingIndicator(sender);
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
                        await this.saveSession(sender, session);
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

                    if (session.useFlow && sender.startsWith('whatsapp:')) {
                        // Meta WhatsApp: send the Native Flow interactive form
                        session.step = 'AWAITING_FLOW';
                        await this.saveSession(sender, session);
                        await this.sendTypingIndicator(sender);
                        await this.sendContentMessage(sender, 'cf_print_flow');
                        return null;
                    }

                    // Telegram & all other channels: skip AWAITING_FLOW, go straight to copies
                    session.step = 'AWAITING_COPIES';
                    await this.saveSession(sender, session);
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
                    const { pages, supabaseUrl, fileName } = await this.getPageCount(sender, mediaUrl, mediaContentType);

                    const fileEntry: UploadedFile = {
                        url: supabaseUrl || mediaUrl,
                        pages,
                        name: fileName || `file_${fileNum}`,
                    };
                    session.files.push(fileEntry);
                    await this.saveSession(sender, session);

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
                    const shopHint = session.nodeId
                        ? `\n🏪 Shop: ${session.nodeCode}`
                        : '\n\n💡 To select a shop, type: shop <code>\n📍 To see available shops, type: shops';
                    await this.sendTextMessage(sender, `Welcome to CopyFlow! 🖨️\n\nSend your files (PDF/Word/image) to get started.\nYou can send multiple files — tap "Done" when finished.${shopHint}`);
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
                await this.saveSession(sender, session);
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
                await this.saveSession(sender, session);
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
                session.step = 'AWAITING_CONFIRMATION';
                await this.saveSession(sender, session);
                const summary = this.generateOrderSummary(session, pricePerPage);
                await this.sendContentMessage(sender, 'cf_order_confirm', { summary });
                return null;
            }

            if (session.step === 'AWAITING_CONFIRMATION') {
                const pricePerPage = session.color ? 10 : 2;
                if (normalizedMessage.includes('confirm_pay') || normalizedMessage.includes('confirm') || normalizedMessage === 'pay' || normalizedMessage === 'yes') {
                    session.step = 'AWAITING_PAYMENT';
                    await this.saveSession(sender, session);
                    return await this.createPaymentLinksAndNotify(session, sender, pricePerPage);
                } else if (normalizedMessage === 'edit_form' || normalizedMessage.includes('edit')) {
                    if (session.useFlow && sender.startsWith('whatsapp:')) {
                        session.step = 'AWAITING_FLOW';
                        await this.saveSession(sender, session);
                        await this.sendTypingIndicator(sender);
                        await this.sendContentMessage(sender, 'cf_print_flow');
                        return null;
                    } else {
                        session.step = 'AWAITING_COPIES';
                        await this.saveSession(sender, session);
                        await this.sendTypingIndicator(sender);
                        await this.sendContentMessage(sender, 'cf_copies_list');
                        return null;
                    }
                } else {
                    const summary = this.generateOrderSummary(session, pricePerPage);
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_order_confirm', { summary });
                    return null;
                }
            }

            if (session.step === 'AWAITING_PAYMENT') {
                let msgLinks = '';
                if (session.paymentLink) {
                    msgLinks = `🔗 Payment link: ${session.paymentLink}`;
                }
                if (session.phonepeLink) {
                    msgLinks += `${msgLinks ? '\n' : ''}🔗 PhonePe: ${session.phonepeLink}`;
                }
                if (session.cashfreeLink) {
                    msgLinks += `${msgLinks ? '\n' : ''}🔗 Cashfree: ${session.cashfreeLink}`;
                }

                if (!msgLinks) {
                    session.step = 'AWAITING_SIDES';
                    await this.saveSession(sender, session);
                    const noLinkMsg = 'Payment link is not available right now. Please choose sides again to regenerate links.';
                    try {
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, noLinkMsg);
                        return null;
                    } catch {
                        return noLinkMsg;
                    }
                }

                const msg = `We are waiting for your payment of ₹${session.price} to be confirmed.\n\n${msgLinks}`;
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

    /**
     * Public entry point called by the PDF analysis queue processor.
     * Analyzes a single file that was uploaded by a user.
     */
    async processPdfInQueue(sender: string, mediaUrl: string, mediaContentType: string, fileNum: number): Promise<void> {
        const session = this.getSession(sender);
        if (!session) {
            this.logger.warn(`processPdfInQueue: no active session for ${sender}, skipping.`);
            return;
        }
        await this.sendTypingIndicator(sender);
        const { pages, supabaseUrl, fileName } = await this.getPageCount(sender, mediaUrl, mediaContentType);

        const fileEntry: UploadedFile = {
            url: supabaseUrl || mediaUrl,
            pages,
            name: fileName || `file_${fileNum}`,
        };
        session.files.push(fileEntry);
        await this.saveSession(sender, session);

        const totalPages = session.files.reduce((sum, f) => sum + f.pages, 0);
        const fileCount = session.files.length;

        await this.sendTypingIndicator(sender);
        await this.sendContentMessage(sender, 'cf_file_uploaded', {
            fileNum,
            pages,
            totalPages,
            fileCount,
        });
    }

    private generateOrderSummary(session: ChatState, pricePerPage: number): string {
        const fileCount = session.files?.length || 0;
        const filesText = fileCount > 1 ? `${fileCount} files, ${session.pages || 1} total pages` : `${session.pages || 1} pages`;
        const isColorStr = session.color ? 'Color' : 'Black and White';
        const price = session.price || ((session.pages || 1) * (session.copies || 1) * pricePerPage);
        return `📋 Order Summary:\n• ${filesText}\n• ${session.copies || 1} copies × ${session.sides}-sided\n• ${isColorStr} @ ₹${pricePerPage}/page\n\n💰 Total Amount: ₹${price}`;
    }

    private async createPaymentLinksAndNotify(session: ChatState, sender: string, pricePerPage: number): Promise<string | null> {
        try {
            this.logger.log(`Starting to create payment links. Price: ${session.price}, Color: ${session.color}, Sides: ${session.sides}`);

            // Bug 4 fix: ensure a nodeId is set before payment
            await this.ensureNodeId(session);
            if (!session.nodeId) {
                throw new Error('No print shop is assigned for this job');
            }

            const kioskStatus = await this.getNodeKioskStatusSnapshot(session.nodeId, session.nodeCode);
            if (!kioskStatus.isPrintingReady) {
                session.step = 'AWAITING_SIDES';
                session.jobId = undefined;
                session.paymentLink = undefined;
                session.phonepeLink = undefined;
                session.cashfreeLink = undefined;
                await this.saveSession(sender, session);

                const blockMessage = `⚠️ The selected kiosk is currently not ready for printing (${kioskStatus.reason}). Payment link was not generated. Please try again in a few minutes.`;
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, blockMessage);
                    return null;
                } catch {
                    return blockMessage;
                }
            }

            const referenceId = `wa_${Date.now()}`;
            session.jobId = referenceId;
            session.sender = sender;
            const paymentSource = sender.startsWith('telegram:') ? 'telegram' : 'whatsapp';
            // Strip any platform prefix (whatsapp:, telegram:, etc.) to get a clean phone number
            const cleanedPhone = sender.replace(/^(whatsapp:|telegram:)/, '');

            await this.sendTypingIndicator(sender);
            const isColorStr = session.color ? 'Color' : 'Black and White';
            const fileCount = session.files.length;
            const description = `Print job (${fileCount} file${fileCount > 1 ? 's' : ''}, ${session.copies || 1}x ${session.sides} ${isColorStr})`;

            session.paymentLink = undefined;

            try {
                this.logger.log('Creating payment link via phonepeService...');
                const phonepeLink = await this.phonepeService.createPaymentLink(
                    session.price as number,
                    referenceId,
                    cleanedPhone,
                    paymentSource
                );
                session.phonepeLink = phonepeLink;
                if (!session.paymentLink) {
                    session.paymentLink = phonepeLink;
                }
            } catch (err: any) {
                this.logger.error(`Error generating PhonePe link: ${err.message}`);
            }

            try {
                this.logger.log('Creating payment link via cashfreeService...');
                const cashfreeLink = await this.cashfreeService.createPaymentLink(
                    session.price as number,
                    referenceId,
                    cleanedPhone,
                    description,
                    paymentSource
                );
                if (cashfreeLink) {
                    session.cashfreeLink = cashfreeLink;
                    if (!session.paymentLink) {
                        session.paymentLink = cashfreeLink;
                    }
                }
            } catch (err: any) {
                this.logger.error(`Error generating Cashfree link: ${err.message}`);
            }

            if (!session.paymentLink && !session.phonepeLink && !session.cashfreeLink) {
                throw new Error('No payment gateway is currently available');
            }

            session.step = 'AWAITING_PAYMENT';

            // Persist session with jobId so webhook can look it up after restart
            await this.saveSession(sender, session);

            const filesText = fileCount > 1 ? `${fileCount} files, ${session.pages || 1} total pages` : `${session.pages || 1} pages`;

            let messageLinks = '';
            if (session.paymentLink) {
                messageLinks = `🔗 Payment link: ${session.paymentLink}`;
            }
            if (session.phonepeLink) {
                messageLinks += `${messageLinks ? '\n' : ''}🔗 Pay via PhonePe: ${session.phonepeLink}`;
            }
            if (session.cashfreeLink) {
                messageLinks += `${messageLinks ? '\n' : ''}🔗 Pay via Cashfree: ${session.cashfreeLink}`;
            }

            const msg = `📋 Order Summary:\n• ${filesText}\n• ${session.copies || 1} copies × ${session.sides}-sided\n• ${isColorStr} @ ₹${pricePerPage}/page\n\n💰 Total: ₹${session.price}\n\n${messageLinks}\n\nWe will start printing once payment is confirmed.`;
            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender, msg);
                return null;
            } catch (err) {
                return msg;
            }
        } catch (error: any) {
            const errorMsg = error?.error?.description || error?.message || 'Unknown payment gateway error';
            this.logger.error(`Error creating payment link: ${errorMsg}`);
            session.step = 'AWAITING_SIDES';
            session.jobId = undefined;
            session.paymentLink = undefined;
            session.phonepeLink = undefined;
            session.cashfreeLink = undefined;
            await this.saveSession(sender, session);
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
        // Try exact match first, then try with whatsapp: prefix for legacy callers
        return this.sessionCache.get(sender)
            || this.sessionCache.get(`whatsapp:${sender.replace('whatsapp:', '')}`)
            || this.sessionCache.get(`telegram:${sender.replace('telegram:', '')}`);
    }

    /**
     * Async version that checks DB when cache is empty (e.g. after restart).
     */
    async getSessionAsync(sender: string): Promise<ChatState | undefined> {
        // Try exact match, then try platform-prefixed variants
        return (await this.loadSession(sender))
            || (await this.loadSession(`whatsapp:${sender.replace('whatsapp:', '')}`))
            || (await this.loadSession(`telegram:${sender.replace('telegram:', '')}`));
    }

    async getSessions(): Promise<any[]> {
        const rows = await this.prisma.chatSession.findMany();
        return rows.map((row) => ({
            sender: row.sender,
            ...(row.data as any),
        }));
    }

    /**
    * Sends an immediate "payment received, printing soon" notification.
    * Called right after payment confirmation so the user isn't left
     * waiting in silence. Does NOT delete the session — we keep it alive
     * so the kiosk-acknowledge path can send the final "job printed" message.
     */
    async notifyPaymentConfirmed(sender: string): Promise<void> {
        this.logger.log(`Sending payment-confirmed notification to ${sender}`);
        try {
            await this.sendTextMessage(
                sender,
                '✅ Payment received! Your print job is queued and will start printing shortly.'
            );
        } catch (error: any) {
            this.logger.error(`Failed to send payment-confirmed message to ${sender}: ${error.message}`);
        }
    }

    async tellStudentJobIsPrinting(sender: string): Promise<boolean> {
        this.logger.log(`Telling student (${sender}) that job is printing...`);

        // Preserve the sender format as-is — it already has the right prefix
        const to = sender;
        const session = await this.getSessionAsync(to);

        // Cleanup ALL uploaded files from Supabase
        if (session && session.files && session.files.length > 0) {
            for (const file of session.files) {
                if (file.url && file.url.includes('supabase.co')) {
                    try {
                        const urlParts = file.url.split('/');
                        const filename = urlParts[urlParts.length - 1];
                        if (filename) {
                            await this.r2Storage.deleteFile(filename);
                            this.logger.log(`Cleaned up Supabase file: ${filename}`);
                        }
                    } catch (e) {
                        this.logger.warn(`Failed to cleanup file ${file.name}: ${e.message}`);
                    }
                }
            }
        }

        // Remove session from cache and DB
        await this.deleteSession(to);

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
