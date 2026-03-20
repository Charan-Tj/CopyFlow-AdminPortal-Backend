import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
 import { Cron } from '@nestjs/schedule';
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
    // Issue 3: custom copies validation loop
    awaitingCustomCopies?: boolean;
    // Issue 4: duplicate file detection
    _pendingUrls?: string[];
    // Issue 6: kiosk offline — preserve preferences
    kioskBlockedAt?: number;
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

    /**
     * Send a button message via the correct provider.
     * Max 3 buttons. On WhatsApp each label must be ≤20 chars.
     */
    private async sendButtonMessage(
        to: string,
        body: string,
        buttons: { id: string; label: string }[],
        header?: string,
        footer?: string,
    ) {
        await this.resolveProvider(to).sendButtonMessage(to, body, buttons, header, footer);
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
            const platform = sender.startsWith('telegram:') ? 'telegram' : sender.startsWith('whatsapp:') ? 'meta' : undefined;
            session = { step: 'AWAITING_FILE', files: [], startedAt: Date.now(), userName: String(userName || '').trim() || undefined, platform };
            await this.saveSession(sender, session);
        } else if (String(userName || '').trim() && !session.userName) {
            session.userName = String(userName || '').trim();
            await this.saveSession(sender, session);
        }

        const normalizedMessage = message.trim().toLowerCase();

        try {
            // ─── Help / Menu command ─────────────────────────────────────────
            if (normalizedMessage === 'help' || normalizedMessage === '/help' || normalizedMessage === 'menu') {
                await this.sendTypingIndicator(sender);

                if (session.step === 'AWAITING_PAYMENT') {
                    // Payment-specific help — always surface RETRY prominently
                    let linksText = '';
                    if (session.phonepeLink) linksText += `🔗 PhonePe: ${session.phonepeLink}\n`;
                    if (session.cashfreeLink) linksText += `🔗 Cashfree: ${session.cashfreeLink}\n`;
                    if (session.paymentLink && !session.phonepeLink && !session.cashfreeLink) {
                        linksText += `🔗 Link: ${session.paymentLink}\n`;
                    }
                    await this.sendButtonMessage(
                        sender,
                        `📍 Waiting for payment of *₹${session.price || '?'}*\n\n${linksText ? linksText + '\n' : ''}Once payment is confirmed, printing starts automatically.`,
                        [
                            { id: 'retry', label: '🔄 Refresh Link' },
                            { id: 'cancel', label: '❌ Cancel Order' },
                        ],
                        '💳 Payment Help',
                        'Link expired? Tap Refresh Link'
                    );
                    return null;
                }

                if (session.step === 'AWAITING_CONFIRMATION') {
                    // Re-show the order summary with action buttons (mirrors the confirm step)
                    const pricePerPage = session.color ? 10 : 2;
                    const summary = this.generateOrderSummary(session, pricePerPage);
                    await this.sendContentMessage(sender, 'cf_order_confirm', { summary });
                    return null;
                }

                if (session.step === 'AWAITING_FILE') {
                    const hasFiles = session.files.length > 0;
                    const body = hasFiles
                        ? `📂 You have *${session.files.length}* file${session.files.length > 1 ? 's' : ''} uploaded.\n\nTap *Done* to continue, or send more files.`
                        : `Send a PDF, Word doc, or image to start printing.\n\n1️⃣ Upload files\n2️⃣ Tap Done\n3️⃣ Choose copies, color & sides\n4️⃣ Pay → prints automatically!`;
                    const buttons: { id: string; label: string }[] = hasFiles
                        ? [{ id: 'done_uploading', label: '✅ Done Uploading' }, { id: 'shops', label: '🏪 Select Shop' }, { id: 'cancel', label: '❌ Cancel' }]
                        : [{ id: 'shops', label: '🏪 Select Shop' }, { id: 'cancel', label: '❌ Start Over' }];
                    await this.sendButtonMessage(sender, body, buttons, '📖 CopyFlow Help', `Step: ${this.getStepLabel(session.step)}`);
                    return null;
                }

                // Generic help for mid-flow steps
                await this.sendButtonMessage(
                    sender,
                    `📍 *You are at:* ${this.getStepLabel(session.step)}\n\nContinue answering the prompts above, or use the buttons below.`,
                    [
                        { id: 'shops', label: '🏪 Shops' },
                        { id: 'cancel', label: '❌ Start Over' },
                    ],
                    '📖 CopyFlow Help',
                    'Type RETRY to refresh payment link'
                );
                return null;
            }

            // ─── Global cancel/reset: works at ANY step ───────────────
            if (normalizedMessage === 'cancel' || normalizedMessage === 'reset' || normalizedMessage === 'restart' || normalizedMessage === '/cancel' || normalizedMessage === '/reset' || normalizedMessage === '/start') {
                await this.deleteSession(sender);
                const platform = sender.startsWith('telegram:') ? 'telegram' : sender.startsWith('whatsapp:') ? 'meta' : undefined;
                session = { step: 'AWAITING_FILE', files: [], startedAt: Date.now(), userName: String(userName || '').trim() || undefined, platform };
                await this.saveSession(sender, session);
                await this.sendTypingIndicator(sender);

                // Issue 8: Telegram /start — show inline shop selector
                if (sender.startsWith('telegram:')) {
                    const activeNodes = await this.prisma.node.findMany({
                        where: { is_active: true },
                        select: { node_code: true, name: true, college: true, city: true },
                        take: 8,
                    });
                    if (activeNodes.length > 0) {
                        await this.telegramProvider.sendShopSelector(sender, activeNodes);
                        return null;
                    }
                }

                await this.sendButtonMessage(
                    sender,
                    '🔄 Session reset! Send your files (PDF, Word, or image) to start a new print job.',
                    [
                        { id: 'shops', label: '🏪 Browse Shops' },
                        { id: 'help', label: '❓ Help' },
                    ],
                    '✅ Fresh Start',
                    'Select a shop first, then upload your files'
                );
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

                    if (activeNodes.length > 0 && sender.startsWith('telegram:')) {
                        // Telegram: offer clickable shop buttons directly
                        await this.telegramProvider.sendShopSelector(sender, activeNodes);
                    } else {
                        let msg = `❌ Shop code "${shopCode}" not found.`;
                        if (activeNodes.length > 0) {
                            msg += '\n\n📍 Available shops:';
                            for (const n of activeNodes) {
                                msg += `\n• ${n.node_code} — ${n.name} (${n.college}, ${n.city})`;
                            }
                            msg += '\n\nType: shop <code> to select one.';
                        }
                        await this.sendTextMessage(sender, msg);
                        await this.sendButtonMessage(sender,
                            'Need help selecting a shop?',
                            [{ id: 'help', label: '❓ Help' }, { id: 'cancel', label: '❌ Start Over' }]
                        );
                    }
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
                    await this.sendTextMessage(sender, '😕 No shops are currently available. Try again later.');
                } else if (sender.startsWith('telegram:')) {
                    // Telegram: full inline keyboard of shops
                    await this.telegramProvider.sendShopSelector(sender, activeNodes);
                } else {
                    // Meta / Twilio: text list + a contextual button
                    let msg = `📍 *Available Shops* (${activeNodes.length}):\n`;
                    for (const n of activeNodes) {
                        msg += `\n• *${n.node_code}* — ${n.name}\n  ${n.college}, ${n.city}`;
                    }
                    msg += '\n\nReply: shop <code>  e.g. shop TESTNODE1';
                    if (session.nodeId) {
                        msg += `\n\n✅ Currently selected: *${session.nodeCode}*`;
                    }
                    await this.sendButtonMessage(sender, msg,
                        [{ id: 'help', label: '❓ Help' }, { id: 'cancel', label: '❌ Start Over' }],
                        '🏪 Select Your Print Shop'
                    );
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
                    await this.sendButtonMessage(
                        sender,
                        `Send your next file (PDF, Word, or image) to start a new print job.${preservedNodeCode ? `\n\n🏪 Shop: *${preservedNodeCode}*` : ''}`,
                        [{ id: 'shops', label: '🏪 Change Shop' }, { id: 'help', label: '❓ Help' }],
                        '✅ Previous order complete!',
                        'Your shop selection is saved'
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
                // Handle QR code start command — Issue 1: richer response
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
                        await this.sendTextMessage(sender,
                            `Welcome to CopyFlow @ ${node.name}! 👋\n📍 ${node.college}, ${node.city}\n\nSend your files (PDF, Word, or image) to get started.\nYou can send multiple files — tap "Done" when finished.\n\n💡 Type HELP anytime if you get stuck.`
                        );
                    } else {
                        const activeNodes = await this.prisma.node.findMany({
                            where: { is_active: true },
                            select: { node_code: true, name: true, college: true, city: true },
                            take: 8,
                        });
                        let errMsg = `❌ Invalid or expired QR code.`;
                        if (activeNodes.length > 0) {
                            errMsg += `\n\n📍 Available shops:`;
                            for (const n of activeNodes) {
                                errMsg += `\n• ${n.node_code} — ${n.name} (${n.college}, ${n.city})`;
                            }
                            errMsg += `\n\nType: shop <code> to select a shop manually.`;
                        }
                        await this.sendTextMessage(sender, errMsg);
                    }
                    return null;
                }

                if (normalizedMessage === 'hi-flow') {
                    session.useFlow = true;
                    await this.saveSession(sender, session);
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, "Interactive Flow mode activated! Please upload your documents to begin.");
                    return null;
                }

                // User taps "Done" — move to copies selection
                if (normalizedMessage === 'done' || normalizedMessage === 'done_uploading') {
                    if (session.files.length === 0) {
                        // HCI: Graceful fallback — don't dead-end, show a button to browse shops
                        await this.sendButtonMessage(
                            sender,
                            `📤 Please send a PDF, Word document, or image first.`,
                            [{ id: 'shops', label: '🏪 Browse Shops' }, { id: 'cancel', label: '❌ Start Over' }],
                            `⚠️ No files uploaded yet`
                        );
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
                    // cf_copies_list message already includes the step header "Step 2 of 4"
                    await this.sendContentMessage(sender, 'cf_copies_list');
                    return null;
                }

                // User sends a file — Issue 4: duplicate file detection
                if (mediaUrl) {
                    const alreadyQueued =
                        session.files.some(f => f.url === mediaUrl) ||
                        (session._pendingUrls || []).includes(mediaUrl);

                    if (alreadyQueued) {
                        await this.sendButtonMessage(
                            sender,
                            'Looks like you already sent this file. Send a different file or tap Done to continue.',
                            [{ id: 'done_uploading', label: '✅ Done Uploading' }],
                            '⚠️ Duplicate File'
                        );
                        return null;
                    }

                    // Issue 12: Maximum files and pages limit
                    const currentTotalPages = session.files.reduce((sum, f) => sum + f.pages, 0);
                    if (session.files.length >= 17) {
                        await this.sendButtonMessage(
                            sender,
                            `You've reached the maximum of 17 files. Tap *Done* to print what you have, or *Cancel* to start over.`,
                            [{ id: 'done_uploading', label: '✅ Done' }, { id: 'cancel', label: '❌ Cancel' }],
                            '⚠️ File limit reached'
                        );
                        return null;
                    }
                    if (currentTotalPages >= 717) {
                        await this.sendButtonMessage(
                            sender,
                            `You've reached the maximum of 717 pages (${currentTotalPages} so far). Tap *Done* to print what you have.`,
                            [{ id: 'done_uploading', label: '✅ Done' }, { id: 'cancel', label: '❌ Cancel' }],
                            '⚠️ Page limit reached'
                        );
                        return null;
                    }

                    if (!session._pendingUrls) session._pendingUrls = [];
                    session._pendingUrls.push(mediaUrl);
                    await this.saveSession(sender, session);

                    await this.sendTypingIndicator(sender);
                    const fileNum = session.files.length + 1;
                    await this.sendTextMessage(sender, `📄 Analyzing file ${fileNum}...`);

                    await this.sendTypingIndicator(sender);
                    const { pages, supabaseUrl, fileName } = await this.getPageCount(sender, mediaUrl, mediaContentType);

                    // Issue 16: Notify user if R2/Supabase upload failed
                    if (!supabaseUrl) {
                        this.logger.warn(`R2 upload failed for ${sender}, using temporary URL`);
                        await this.sendTextMessage(sender,
                            '⚠️ Note: File uploaded with temporary storage. Please complete your order soon.'
                        );
                    }

                    const fileEntry: UploadedFile = {
                        url: supabaseUrl || mediaUrl,
                        pages,
                        name: fileName || `file_${fileNum}`,
                    };
                    session.files.push(fileEntry);
                    session._pendingUrls = (session._pendingUrls || []).filter(u => u !== mediaUrl);
                    await this.saveSession(sender, session);

                    const totalPages = session.files.reduce((sum, f) => sum + f.pages, 0);
                    const fileCount = session.files.length;

                    // HCI: Single combined button message — no separate nextHint text needed
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_file_uploaded', {
                        fileNum,
                        pages,
                        totalPages,
                        fileCount,
                        hasShop: !!session.nodeId,
                    });
                    // If no shop selected yet, remind with a button
                    if (!session.nodeId) {
                        await this.sendButtonMessage(
                            sender,
                            '⚠️ You haven\'t selected a print shop yet!',
                            [{ id: 'shops', label: '🏪 Browse Shops' }],
                            undefined,
                            'Select a shop before tapping Done'
                        );
                    }
                    return null;
                }

                // Scenario 1 fix: welcome-back with buttons, or fresh welcome with shop-selector button
                try {
                    await this.sendTypingIndicator(sender);

                    if (session.files.length > 0) {
                        // Returning user who already uploaded files — show status + buttons
                        const totalPages = session.files.reduce((sum, f) => sum + f.pages, 0);
                        const shopFooter = session.nodeId
                            ? `Shop: ${session.nodeCode}`
                            : 'Don\'t forget to select a shop!';
                        await this.sendButtonMessage(
                            sender,
                            `📂 You have *${session.files.length} file${session.files.length > 1 ? 's' : ''}* uploaded (${totalPages} page${totalPages > 1 ? 's' : ''} total).\n\nTap *Done* to continue, or send more files.`,
                            [
                                { id: 'done_uploading', label: '✅ Done Uploading' },
                                { id: 'shops', label: '🏪 Change Shop' },
                                { id: 'cancel', label: '❌ Start Over' },
                            ],
                            '👋 Welcome back!',
                            shopFooter
                        );
                        return null;
                    }

                    // First-time / fresh session welcome
                    const shopFooter = session.nodeId
                        ? `Selected shop: ${session.nodeCode}`
                        : 'Tap "Browse Shops" to pick your print shop first';
                    await this.sendButtonMessage(
                        sender,
                        `Here's how it works:\n` +
                        `1️⃣ Select your shop\n` +
                        `2️⃣ Upload your files (PDF/Word/image)\n` +
                        `3️⃣ Tap *Done* → choose copies, color & sides\n` +
                        `4️⃣ Pay → files print automatically! ✅`,
                        [
                            { id: 'shops', label: '🏪 Browse Shops' },
                            { id: 'help', label: '❓ Help' },
                        ],
                        '👋 Welcome to CopyFlow!',
                        shopFooter
                    );
                    return null;
                } catch (err) {
                    this.logger.error(`Send error: ${err.message}`);
                    return 'Welcome to CopyFlow! Send your files (PDF/Word/image) to get started.';
                }
            }

            if (session.step === 'AWAITING_COPIES') {
                // Issue 3: custom copies — check flag first
                if (session.awaitingCustomCopies) {
                    const num = parseInt(normalizedMessage.match(/\d+/)?.[0] || '', 10);
                    if (isNaN(num) || num < 1 || num > 99) {
                        await this.sendTextMessage(sender, '❌ Please enter a number between 1 and 99.');
                        return null;
                    }
                    session.copies = num;
                    session.awaitingCustomCopies = false;
                    session.step = 'AWAITING_COLOR';
                    await this.saveSession(sender, session);
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_color_quickrep');
                    return null;
                }

                if (normalizedMessage === 'other' || normalizedMessage === 'copies_other') {
                    session.awaitingCustomCopies = true;
                    await this.saveSession(sender, session);
                    try {
                        await this.sendTypingIndicator(sender);
                        await this.sendButtonMessage(
                            sender,
                            'Type a number between 1 and 99 (e.g. *5*):',
                            [{ id: 'cancel', label: '❌ Cancel' }],
                            '🔢 How many copies?'
                        );
                        return null;
                    } catch (err) {
                        return 'How many copies? Please type a number (1-99):';
                    }
                }

                let copies: number | undefined;
                const match = normalizedMessage.match(/\d+/);
                if (match) {
                    const num = parseInt(match[0], 10);
                    // Validate range for all numeric inputs
                    if (num < 1 || num > 99) {
                        await this.sendTypingIndicator(sender);
                        await this.sendTextMessage(sender, '❌ Please enter a number between 1 and 99.');
                        await this.sendContentMessage(sender, 'cf_copies_list');
                        return null;
                    }
                    copies = num;
                } else if (normalizedMessage.includes('1 copy') || message === '1') copies = 1;
                else if (normalizedMessage.includes('2 copies') || message === '2') copies = 2;
                else if (normalizedMessage.includes('3 copies') || message === '3') copies = 3;
                else if (normalizedMessage === 'copies_1') copies = 1;
                else if (normalizedMessage === 'copies_2') copies = 2;
                else if (normalizedMessage === 'copies_3') copies = 3;

                // Reject invalid input instead of defaulting to 1
                if (copies === undefined) {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, '❓ Please select how many copies you need.\n\n💡 Type *MENU* if you need help.');
                    await this.sendContentMessage(sender, 'cf_copies_list');
                    return null;
                }

                session.copies = copies;
                session.step = 'AWAITING_COLOR';
                await this.saveSession(sender, session);
                await this.sendTypingIndicator(sender);
                // Skip a separate status text — the color button message header says "Step 3 of 4"
                await this.sendContentMessage(sender, 'cf_color_quickrep');
                return null;
            }

            if (session.step === 'AWAITING_COLOR') {
                // Use exact matching to avoid false positives like "not color" triggering color=true
                const validColorInputs = ['color', 'colour'];
                const validBWInputs = ['bw', 'b&w', 'black', 'black & white', 'black and white', 'blackandwhite'];

                if (validColorInputs.includes(normalizedMessage) || message === 'color') {
                    session.color = true;
                } else if (validBWInputs.includes(normalizedMessage) || message === 'bw') {
                    session.color = false;
                } else {
                    // HCI: Graceful fallback — resend options with explanation
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, `❓ Please choose a print color for your ${session.pages || 1} page${(session.pages||1)>1?'s':''}:\n\n💡 Type *MENU* if you need help.`);
                    await this.sendContentMessage(sender, 'cf_color_quickrep');
                    return null;
                }

                session.step = 'AWAITING_CONFIRMATION';
                await this.saveSession(sender, session);
                await this.sendTypingIndicator(sender);
                // Skip separate status text — sides button message header says "Step 4 of 4"
                await this.sendContentMessage(sender, 'cf_sides_quickrep');
                return null;
            }

            if (session.step === 'AWAITING_SIDES') {
                // Use exact matching to avoid false positives like "I don't want double" triggering double=true
                const validDoubleInputs = ['double', 'double sided', 'double-sided', 'doublesided'];
                const validSingleInputs = ['single', 'single sided', 'single-sided', 'singlesided'];

                if (validDoubleInputs.includes(normalizedMessage) || message === 'double') {
                    session.sides = 'double';
                } else if (validSingleInputs.includes(normalizedMessage) || message === 'single') {
                    session.sides = 'single';
                } else {
                    // HCI: Graceful fallback — resend with context
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, `❓ Almost there! Choose how to print your ${session.pages || 1} pages:\n\n💡 Type *MENU* if you need help.`);
                    await this.sendContentMessage(sender, 'cf_sides_quickrep');
                    return null;
                }

                const pricePerPage = session.color ? 10 : 2;
                session.price = (session.pages || 1) * (session.copies || 1) * pricePerPage;
                session.step = 'AWAITING_CONFIRMATION';
                await this.saveSession(sender, session);
                // HCI: Confirmation before money — always show full summary
                await this.sendTypingIndicator(sender);

                // Issue 13: Warn for large orders — embed in the same confirmation button message
                const priceTag = session.price > 2000
                    ? `\n\n⚠️ *Large order:* Total is ₹${session.price}. Review carefully before paying.`
                    : '';

                const summary = this.generateOrderSummary(session, pricePerPage);
                await this.sendContentMessage(sender, 'cf_order_confirm', { summary: summary + priceTag });
                return null;
            }

            if (session.step === 'AWAITING_CONFIRMATION') {
                const pricePerPage = session.color ? 10 : 2;

                // Issue 6: kiosk was blocked — retry falls through to confirm logic
                if (session.kioskBlockedAt && (normalizedMessage === 'retry' || normalizedMessage.includes('confirm'))) {
                    session.kioskBlockedAt = undefined;
                }

                if (normalizedMessage.includes('confirm_pay') || normalizedMessage.includes('confirm') || normalizedMessage === 'pay' || normalizedMessage === 'yes') {
                    // HCI: Status update — tell user payment link is being generated
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, '⏳ Generating your payment link...');
                    session.step = 'AWAITING_PAYMENT';
                    await this.saveSession(sender, session);
                    return await this.createPaymentLinksAndNotify(session, sender, pricePerPage);
                } else if (normalizedMessage === 'edit_form' || normalizedMessage.includes('edit')) {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, '✏️ No problem! Let\'s update your preferences.');
                    if (session.useFlow && sender.startsWith('whatsapp:')) {
                        session.step = 'AWAITING_FLOW';
                        await this.saveSession(sender, session);
                        await this.sendContentMessage(sender, 'cf_print_flow');
                        return null;
                    } else {
                        session.step = 'AWAITING_COPIES';
                        await this.saveSession(sender, session);
                        await this.sendContentMessage(sender, 'cf_copies_list');
                        return null;
                    }
                } else {
                    // HCI: Graceful fallback — re-show the order summary with buttons
                    const summary = this.generateOrderSummary(session, pricePerPage);
                    await this.sendTypingIndicator(sender);
                    await this.sendContentMessage(sender, 'cf_order_confirm', { summary });
                    return null;
                }
            }

            if (session.step === 'AWAITING_PAYMENT') {
                // Issue 5: Expired payment links — RETRY command
                if (normalizedMessage === 'retry' || normalizedMessage === 'renew' || normalizedMessage === 'new link') {
                    session.paymentLink = undefined;
                    session.phonepeLink = undefined;
                    session.cashfreeLink = undefined;
                    session.jobId = undefined;
                    session.step = 'AWAITING_CONFIRMATION';
                    await this.saveSession(sender, session);
                    await this.sendTextMessage(sender, '🔄 Generating a fresh payment link...');
                    return await this.handleIncomingMessage(sender, 'confirm_pay');
                }

                // Scenario 5 fix: handle "I already paid" and status-check keywords with a helpful button response
                const paymentStatusKeywords = ['paid', 'done', 'completed', 'status', 'when', 'printed', 'print', 'check'];
                if (paymentStatusKeywords.some(kw => normalizedMessage === kw || normalizedMessage.startsWith(kw + ' ') || normalizedMessage.endsWith(' ' + kw))) {
                    await this.sendTypingIndicator(sender);
                    await this.sendButtonMessage(
                        sender,
                        `Once your payment is received, printing starts automatically and you'll get a notification.\n\nIf you've already paid and this is still showing, please wait 1–2 minutes for confirmation.`,
                        [
                            { id: 'retry', label: '🔄 Refresh Link' },
                            { id: 'cancel', label: '❌ Cancel Order' },
                        ],
                        `⏳ Waiting for ₹${session.price} payment`,
                        'Tap Refresh Link if your payment link expired'
                    );
                    return null;
                }

                // Default: show payment links with RETRY button
                let linksText = '';
                if (session.phonepeLink) linksText += `🔗 PhonePe: ${session.phonepeLink}\n`;
                if (session.cashfreeLink) linksText += `🔗 Cashfree: ${session.cashfreeLink}\n`;
                if (session.paymentLink && !session.phonepeLink && !session.cashfreeLink) {
                    linksText += `🔗 Pay here: ${session.paymentLink}\n`;
                }

                if (!linksText) {
                    // No links — push back to confirmation so user can re-generate
                    session.step = 'AWAITING_CONFIRMATION';
                    await this.saveSession(sender, session);
                    try {
                        await this.sendTypingIndicator(sender);
                        await this.sendButtonMessage(
                            sender,
                            'Payment link is not available. Tap below to try generating a new one.',
                            [{ id: 'confirm_pay', label: '✅ Generate Link' }, { id: 'cancel', label: '❌ Cancel' }],
                            '⚠️ No Payment Link'
                        );
                        return null;
                    } catch {
                        return 'Payment link unavailable. Type YES to try again or CANCEL to start over.';
                    }
                }

                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendButtonMessage(
                        sender,
                        `${linksText}\nWe'll notify you as soon as payment is confirmed and printing begins.`,
                        [
                            { id: 'retry', label: '🔄 Refresh Link' },
                            { id: 'cancel', label: '❌ Cancel Order' },
                        ],
                        `💰 Pay ₹${session.price} to print`,
                        'Link expired? Tap Refresh Link'
                    );
                    return null;
                } catch (err) {
                    return `Pay ₹${session.price}: ${linksText}\nType RETRY for a new link.`;
                }
            }

            // HCI: Graceful fallback — universal dead end with MENU hint
            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender,
                    `🤔 I didn't quite get that.\n\n` +
                    `📍 You are at: *${this.getStepLabel(session.step)}*\n\n` +
                    `Type *MENU* to see all options, or *CANCEL* to start over.`
                );
                return null;
            } catch (err) {
                return 'Type MENU for help or CANCEL to start over.';
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
        const session = await this.loadSession(sender);
        if (!session) {
            this.logger.warn(`processPdfInQueue: no active session for ${sender}, skipping.`);
            return;
        }
        await this.sendTypingIndicator(sender);
        const { pages, supabaseUrl, fileName } = await this.getPageCount(sender, mediaUrl, mediaContentType);

        // Issue 16: Notify user if R2/Supabase upload failed
        if (!supabaseUrl) {
            this.logger.warn(`R2 upload failed for ${sender}, using temporary URL`);
            await this.sendTextMessage(sender,
                '⚠️ Note: File uploaded with temporary storage. Please complete your order soon.'
            );
        }

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

    // Issue 2 + Scenario 2 fix: Session TTL — 30-minute cleanup cron with 5-minute expiry warning
    @Cron('*/15 * * * *')
    async cleanupExpiredSessions(): Promise<void> {
        const now = Date.now();
        const cutoff = new Date(now - 30 * 60 * 1000);       // 30 min → delete
        const warnCutoff = new Date(now - 25 * 60 * 1000);   // 25 min → warn (5 min before deletion)
        try {
            const expiredRows = await this.prisma.chatSession.findMany({
                where: { updatedAt: { lt: warnCutoff } },
                select: { sender: true, data: true, updatedAt: true },
            });

            const toDelete: string[] = [];
            const toWarn: { sender: string; data: any }[] = [];

            for (const row of expiredRows) {
                const d = row.data as any;
                // Never delete PAID or PRINTED sessions
                if (d?.step === 'PAID' || d?.step === 'PRINTED') continue;

                if (row.updatedAt < cutoff) {
                    toDelete.push(row.sender);
                } else {
                    // In the 25–30 min window — send a warning if not already warned
                    if (!d?._expiryWarnedAt) {
                        toWarn.push({ sender: row.sender, data: d });
                    }
                }
            }

            // Send expiry warnings
            for (const { sender, data } of toWarn) {
                try {
                    await this.sendTextMessage(sender,
                        `⏰ *Heads up!* Your CopyFlow session will expire in ~5 minutes due to inactivity.\n\n` +
                        `Type anything or send a file to keep it active.\n` +
                        `📍 Current step: *${this.getStepLabel(data?.step || 'AWAITING_FILE')}*`
                    );
                    // Mark as warned so we don't spam on the next cron tick
                    const session = await this.loadSession(sender);
                    if (session) {
                        (session as any)._expiryWarnedAt = now;
                        await this.saveSession(sender, session);
                    }
                    this.logger.log(`Sent expiry warning to ${sender}`);
                } catch (warnErr: any) {
                    this.logger.warn(`Failed to send expiry warning to ${sender}: ${warnErr.message}`);
                }
            }

            // Delete fully expired sessions
            if (toDelete.length > 0) {
                await this.prisma.chatSession.deleteMany({
                    where: { sender: { in: toDelete } },
                });
                toDelete.forEach(s => this.sessionCache.delete(s));
                this.logger.log(`Cleaned up ${toDelete.length} expired sessions`);
            }
        } catch (err: any) {
            this.logger.warn(`Session TTL cleanup failed: ${err.message}`);
        }
    }

    // HCI helper — human-readable step labels for context messages
    private getStepLabel(step: string): string {
        const labels: Record<string, string> = {
            'AWAITING_FILE':         'Step 1 — Upload files',
            'AWAITING_COPIES':       'Step 2 — Choose copies',
            'AWAITING_COLOR':        'Step 3 — Choose color',
            'AWAITING_SIDES':        'Step 4 — Choose sides',
            'AWAITING_FLOW':         'Step 2 — Print settings form',
            'AWAITING_CONFIRMATION': 'Review order',
            'AWAITING_PAYMENT':      'Awaiting payment',
            'PAID':                  'Payment confirmed',
            'PRINTED':               'Job printed ✅',
        };
        return labels[step] || step;
    }

    // Issue 7: enhanced order summary with file names
    private generateOrderSummary(session: ChatState, pricePerPage: number): string {
        const fileCount = session.files?.length || 0;
        const totalPages = session.pages || 1;

        let filesText = '';
        if (fileCount === 1) {
            filesText = `📄 ${session.files[0]?.name || 'File'} (${totalPages} pages)`;
        } else if (fileCount > 1) {
            const preview = session.files.slice(0, 3)
                .map(f => `  • ${f.name} (${f.pages} pg)`).join('\n');
            const more = fileCount > 3 ? `\n  ...and ${fileCount - 3} more` : '';
            filesText = `📄 ${fileCount} files, ${totalPages} total pages\n${preview}${more}`;
        } else {
            filesText = `📄 ${totalPages} pages`;
        }

        const colorStr = session.color ? '🎨 Color' : '⬛ Black & White';
        const sidesStr = session.sides === 'double' ? 'Double-sided' : 'Single-sided';
        const copies = session.copies || 1;
        const copiesStr = copies === 1 ? '1 copy' : `${copies} copies`;
        const price = session.price || (totalPages * copies * pricePerPage);

        return `📋 *Order Summary*\n\n${filesText}\n• ${copiesStr} · ${sidesStr}\n• ${colorStr} @ ₹${pricePerPage}/page\n\n💰 *Total: ₹${price}*`;
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
                // Issue 6: kiosk offline — preserve all preferences, keep in AWAITING_CONFIRMATION
                session.step = 'AWAITING_CONFIRMATION';
                session.kioskBlockedAt = Date.now();
                await this.saveSession(sender, session);

                const msg = `⚠️ The print shop is temporarily offline (${kioskStatus.reason}).\n\nYour order is saved. Reply *RETRY* in a few minutes and we'll try again.\n\n${this.generateOrderSummary(session, pricePerPage)}`;
                try {
                    await this.sendTypingIndicator(sender);
                    await this.sendTextMessage(sender, msg);
                    return null;
                } catch {
                    return msg;
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
            session.step = 'AWAITING_CONFIRMATION';
            session.jobId = undefined;
            session.paymentLink = undefined;
            session.phonepeLink = undefined;
            session.cashfreeLink = undefined;
            await this.saveSession(sender, session);
            // HCI: Graceful fallback — explain what happened + escape hatch
            try {
                await this.sendTypingIndicator(sender);
                await this.sendTextMessage(sender,
                    `⚠️ Sorry, we couldn't generate a payment link right now.\n\n` +
                    `Your files and preferences are saved.\n\n` +
                    `🔄 Type *RETRY* to try again, or *CANCEL* to start over.`
                );
                return null;
            } catch (err) {
                return 'Payment link failed. Type RETRY to try again or CANCEL to start over.';
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
            // HCI: Status update — user never wonders "did it work?"
            await this.sendTextMessage(
                sender,
                '✅ *Payment received!*\n\n' +
                'Your print job is now in the queue.\n' +
                '🖨️ Printing will begin shortly — you\'ll get a confirmation once it\'s done!'
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

        // Send message BEFORE deleting session to allow retry if message fails
        try {
            // HCI: Status update — final confirmation so user knows it's done
            await this.sendTextMessage(to,
                '🖨️ *Your files are printing now!*\n\n' +
                'Head to the print shop to collect your printout.\n\n' +
                'Thank you for using CopyFlow! 🎉\n' +
                'Send a new file anytime to print again.'
            );
            this.logger.log(`Successfully sent print confirmation to ${to}`);

            // Only delete session after successful message delivery
            await this.deleteSession(to);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send WhatsApp confirmation. Error: ${error.message}`);
            // Keep session so we can retry later
            return false;
        }
    }
}
