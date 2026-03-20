import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';
import { Telegraf, Markup, Context } from 'telegraf';
import axios from 'axios';
import { WhatsappQueueService } from '../whatsapp.queue';

/**
 * Telegram Provider (Webhook Mode)
 * Uses Telegram webhooks instead of long-polling for instant, conflict-free message delivery.
 * Telegram POSTs updates to: {BACKEND_URL}/whatsapp/telegram-webhook
 */
@Injectable()
export class TelegramProvider implements WhatsappProvider, OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TelegramProvider.name);
    private static bot: Telegraf | null = null;
    private static isInitialized = false;

    constructor(
        @Inject(forwardRef(() => WhatsappQueueService))
        private readonly queueService: WhatsappQueueService
    ) {
        require('dotenv').config();
        const token = process.env.TELEGRAM_BOT_TOKEN;
        this.logger.log(`TelegramProvider constructor. Token exists: ${!!token}, bot exists: ${!!TelegramProvider.bot}`);

        if (token && !TelegramProvider.bot) {
            TelegramProvider.bot = new Telegraf(token);
            this.setupListeners();
        } else if (!token) {
            this.logger.warn('TELEGRAM_BOT_TOKEN not found! Telegram provider will not receive messages.');
        } else if (TelegramProvider.bot) {
            this.setupListeners();
        }
    }

    async onModuleInit() {
        if (TelegramProvider.bot && !TelegramProvider.isInitialized) {
            TelegramProvider.isInitialized = true;

            const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL
                || `${process.env.BACKEND_URL || 'https://copyflow-backend-omzk.onrender.com'}/whatsapp/telegram-webhook`;

            try {
                // First, delete any existing webhook or stop polling
                await TelegramProvider.bot.telegram.deleteWebhook({ drop_pending_updates: true });

                // Set the new webhook
                await TelegramProvider.bot.telegram.setWebhook(webhookUrl, {
                    drop_pending_updates: true,
                    allowed_updates: ['message', 'callback_query'],
                });

                this.logger.log(`🚀 Telegram Webhook set: ${webhookUrl}`);

                // Verify it was set
                const info = await TelegramProvider.bot.telegram.getWebhookInfo();
                this.logger.log(`📡 Webhook info: url=${info.url}, pending=${info.pending_update_count}`);

                // Set the bot command menu (shows when user types "/")
                await TelegramProvider.bot.telegram.setMyCommands([
                    { command: 'start', description: '🔄 Start a new print session' },
                    { command: 'shops', description: '📍 List available print shops' },
                    { command: 'cancel', description: '❌ Cancel current session' },
                    { command: 'reset', description: '🔄 Reset and start over' },
                    { command: 'help', description: '❓ How to use CopyFlow' },
                ]);
                this.logger.log('📋 Telegram bot command menu set');
            } catch (e: any) {
                this.logger.error(`Failed to set Telegram webhook: ${e.message}`);
                TelegramProvider.isInitialized = false;
            }
        }
    }

    async onModuleDestroy() {
        // Don't remove the webhook on shutdown — Render restarts quickly
        // and we want Telegram to queue messages during restart
        this.logger.log('Telegram Provider shutting down (webhook remains active)');
    }

    /**
     * Called by the WhatsappController when Telegram POSTs an update to /whatsapp/telegram-webhook.
     * Feeds the raw update into Telegraf so our listeners fire.
     */
    async handleWebhookUpdate(update: any): Promise<void> {
        if (!TelegramProvider.bot) {
            this.logger.warn('Received webhook update but bot is not initialized');
            return;
        }
        await TelegramProvider.bot.handleUpdate(update);
    }

    /**
     * Expose the bot instance for direct access if needed 
     */
    static getBot(): Telegraf | null {
        return TelegramProvider.bot;
    }

    private setupListeners() {
        if (!TelegramProvider.bot) return;

        TelegramProvider.bot.on('message', async (ctx: any) => {
            const parsed = await this.parseIncomingWebhook({ type: 'message', ctx });
            if (parsed.sender) {
                await this.queueService.add('process-incoming', parsed);
            }
        });

        TelegramProvider.bot.on('callback_query', async (ctx: any) => {
            let parsed = await this.parseIncomingWebhook({ type: 'callback', ctx });
            // Issue 8: map "shop_AIT01" callback → "shop AIT01" so existing handler picks it up
            if (parsed.message?.startsWith('shop_')) {
                parsed = { ...parsed, message: parsed.message.replace('shop_', 'shop ') };
            }
            if (parsed.sender) {
                await this.queueService.add('process-incoming', parsed);
            }
            try {
                await ctx.answerCbQuery();
            } catch (e) { }
        });
    }

    private formatTo(to: string): number {
        return parseInt(to.replace('telegram:', '').replace('whatsapp:', '').replace('+', ''), 10);
    }

    // Issue 8: Send inline keyboard with shop list for Telegram /start
    async sendShopSelector(to: string, nodes: { node_code: string; name: string; college: string; city: string }[]): Promise<void> {
        const chatId = this.formatTo(to);
        if (isNaN(chatId) || !TelegramProvider.bot) return;

        const buttons = nodes.map(n =>
            [Markup.button.callback(`${n.name} (${n.node_code})`, `shop_${n.node_code}`)]
        );

        try {
            await TelegramProvider.bot.telegram.sendMessage(
                chatId,
                'Welcome to CopyFlow!\n\nSelect your print shop to get started:',
                Markup.inlineKeyboard(buttons)
            );
        } catch (error: any) {
            this.logger.error(`Error sending shop selector to ${to}: ${error.message}`);
        }
    }

    /**
     * Ask a Telegram user to share their phone number.
     * Sends a ReplyKeyboard with a single contact-request button.
     * The bot receives the contact as a 'contact' update (handled in setupListeners).
     */
    async sendPhoneRequest(to: string): Promise<void> {
        const chatId = this.formatTo(to);
        if (isNaN(chatId) || !TelegramProvider.bot) return;
        try {
            await TelegramProvider.bot.telegram.sendMessage(
                chatId,
                '*One last step!*\n\nWe need your phone number to generate the payment link.\n\nTap the button below to share it securely:',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [[{ text: 'Share My Phone Number', request_contact: true }]],
                        resize_keyboard: true,
                        one_time_keyboard: true,
                    },
                } as any
            );
        } catch (error: any) {
            this.logger.error(`Error sending Telegram phone request: ${error.message}`);
            // Fallback: ask them to type it
            await this.sendTextMessage(to,
                'Please type your 10-digit mobile number so we can generate your payment link (e.g. 9876543210):'
            );
        }
    }

    /**
     * Sends or updates the interactive Print Settings keyboard matrix.
     */
    async sendSettingsMatrix(
        to: string,
        copies: number,
        isColor: boolean,
        isDouble: boolean,
        isUpdate: boolean = false,
        messageId?: number,
        isFinal: boolean = false
    ): Promise<void> {
        const chatId = this.formatTo(to);
        if (isNaN(chatId) || !TelegramProvider.bot) return;

        let body = `*Print Settings*\n\nUse the buttons below to configure your print job.`;
        if (isFinal) {
            body = `*Print Settings Confirmed*\n\nCopies: ${copies}\nColor: ${isColor ? 'Yes' : 'No'}\nDouble-sided: ${isDouble ? 'Yes' : 'No'}`;
        }

        const buttons = [
            [
                Markup.button.callback('➖', 'tg_mat_dec'),
                Markup.button.callback(`${copies} Cop${copies === 1 ? 'y' : 'ies'}`, 'tg_mat_noop'),
                Markup.button.callback('➕', 'tg_mat_inc'),
            ],
            [
                Markup.button.callback(isColor ? '⬜ Black & White' : '☑️ Black & White', 'tg_mat_bw'),
                Markup.button.callback(isColor ? '☑️ Color' : '⬜ Color', 'tg_mat_col'),
            ],
            [
                Markup.button.callback(isDouble ? '⬜ Single Sided' : '☑️ Single Sided', 'tg_mat_ss'),
                Markup.button.callback(isDouble ? '☑️ Double Sided' : '⬜ Double Sided', 'tg_mat_ds'),
            ]
        ];

        if (!isFinal) {
            buttons.push([Markup.button.callback('✅ Confirm & Pay', 'tg_mat_submit')]);
        }

        const markup = isFinal ? Markup.inlineKeyboard([]) : Markup.inlineKeyboard(buttons);

        try {
            if (isUpdate && messageId) {
                await TelegramProvider.bot.telegram.editMessageText(chatId, messageId, undefined, body, {
                    parse_mode: 'Markdown',
                    ...markup
                });
            } else {
                await TelegramProvider.bot.telegram.sendMessage(chatId, body, {
                    parse_mode: 'Markdown',
                    ...markup
                });
            }
        } catch (err: any) {
            try {
                const plainBody = body.replace(/[*_~`]/g, '');
                if (isUpdate && messageId) {
                    await TelegramProvider.bot.telegram.editMessageText(chatId, messageId, undefined, plainBody, markup);
                } else {
                    await TelegramProvider.bot.telegram.sendMessage(chatId, plainBody, markup);
                }
            } catch (e2) {}
        }
    }

    async sendTextMessage(to: string, body: string): Promise<void> {
        if (!TelegramProvider.bot) return;

        try {
            const chatId = this.formatTo(to);
            if (!isNaN(chatId)) {
                try {
                    await TelegramProvider.bot.telegram.sendMessage(chatId, body, { parse_mode: 'Markdown' });
                } catch (err: any) {
                    // If Markdown parsing fails, send as plain text, removing common Markdown characters
                    this.logger.warn(`Markdown failed for text message, retrying plain: ${err.message}`);
                    await TelegramProvider.bot.telegram.sendMessage(chatId, body.replace(/[*_~`]/g, ''));
                }
            }
        } catch (e2: any) {
            this.logger.error(`Error sending Telegram msg: ${(e2 as any).message}`);
        }
    }

    /**
     * Send a message with up to 3 quick-reply inline keyboard buttons.
     * Buttons are arranged in rows of 2 across, last one centered if odd count.
     */
    async sendButtonMessage(
        to: string,
        body: string,
        buttons: { id: string; label: string }[],
        header?: string,
        footer?: string,
    ): Promise<void> {
        try {
            const chatId = this.formatTo(to);
            if (isNaN(chatId) || !TelegramProvider.bot) return;

            const fullText = [
                header ? `*${header}*` : '',
                body,
                footer ? `_${footer}_` : '',
            ].filter(Boolean).join('\n\n');

            // Build rows: pair buttons 2-per-row
            const rows: any[] = [];
            for (let i = 0; i < buttons.length; i += 2) {
                const row = [Markup.button.callback(buttons[i].label, buttons[i].id)];
                if (buttons[i + 1]) row.push(Markup.button.callback(buttons[i + 1].label, buttons[i + 1].id));
                rows.push(row);
            }

            const keyboard = Markup.inlineKeyboard(rows);

            try {
                // First attempt: with Markdown formatting
                await TelegramProvider.bot.telegram.sendMessage(chatId, fullText, {
                    ...keyboard,
                    parse_mode: 'Markdown',
                });
            } catch (markdownErr: any) {
                // Markdown failed (e.g. unescaped quotes in gateway error strings)
                // Retry WITHOUT parse_mode so buttons still appear as real buttons
                this.logger.warn(`Markdown failed for button message, retrying plain: ${markdownErr.message}`);
                const plainText = [
                    header || '',
                    body,
                    footer || '',
                ].filter(Boolean).join('\n\n');
                await TelegramProvider.bot.telegram.sendMessage(chatId, plainText, {
                    ...keyboard,
                    // no parse_mode — plain text always works
                });
            }
        } catch (error: any) {
            this.logger.error(`Error sending Telegram button message: ${error.message}`);
            // Last resort: plain text with button labels listed (no keyboard at all)
            const btns = buttons.map(b => b.label).join(' | ');
            await this.sendTextMessage(to, `${body}\n\n${btns}`);
        }
    }

    async sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void> {
        try {
            const chatId = this.formatTo(to);
            if (isNaN(chatId) || !TelegramProvider.bot) return;

            if (contentSid === 'cf_file_uploaded') {
                const { fileNum, pages, totalPages, fileCount } = variables || {};
                const summary = fileCount > 1
                    ? `✅ *File ${fileNum} received* — ${pages} page${pages > 1 ? 's' : ''}\n\n📁 Total: *${fileCount} files, ${totalPages} pages*`
                    : `✅ *File received* — ${pages} page${pages > 1 ? 's' : ''}`;

                await TelegramProvider.bot.telegram.sendMessage(
                    chatId,
                    `${summary}\n\n📌 Send more files, or tap *Done* when finished.`,
                    {
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('✅ Done — Continue to Print', 'done_uploading')],
                        ]),
                        parse_mode: 'Markdown',
                    }
                );
            } else if (contentSid === 'cf_order_confirm') {
                await TelegramProvider.bot.telegram.sendMessage(
                    chatId,
                    variables?.summary || 'Order Summary',
                    {
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('✅ Confirm & Pay', 'confirm_pay')],
                            [Markup.button.callback('✏️ Edit Preferences', 'edit_form'), Markup.button.callback('❌ Cancel', 'cancel')],
                        ]),
                        parse_mode: 'Markdown',
                    }
                );
            } else if (contentSid === 'cf_copies_list') {
                await TelegramProvider.bot.telegram.sendMessage(
                    chatId,
                    '🖨️ *Step 2 of 4:* How many copies do you need?',
                    {
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('1️⃣  1 Copy', 'copies_1'), Markup.button.callback('2️⃣  2 Copies', 'copies_2')],
                            [Markup.button.callback('3️⃣  3 Copies', 'copies_3'), Markup.button.callback('🔢 Other', 'copies_other')],
                        ]),
                        parse_mode: 'Markdown',
                    }
                );
            } else if (contentSid === 'cf_color_quickrep') {
                await TelegramProvider.bot.telegram.sendMessage(
                    chatId,
                    '🎨 *Step 3 of 4:* Choose print type:',
                    {
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('⬛ Black & White  ₹2/page', 'bw')],
                            [Markup.button.callback('🎨 Color  ₹10/page', 'color')],
                        ]),
                        parse_mode: 'Markdown',
                    }
                );
            } else if (contentSid === 'cf_sides_quickrep') {
                await TelegramProvider.bot.telegram.sendMessage(
                    chatId,
                    '📄 *Step 4 of 4:* Choose print sides:',
                    {
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('📄 Single Sided', 'single'), Markup.button.callback('📋 Double Sided', 'double')],
                        ]),
                        parse_mode: 'Markdown',
                    }
                );
            } else {
                await this.sendTextMessage(to, "Please reply manually to select your options.");
            }
        } catch (error: any) {
            this.logger.error(`Error sending Telegram interactive message: ${error.message}`);
            await this.sendTextMessage(to, "Please reply manually. (Interactive formatting failed)");
        }
    }

    async sendTypingIndicator(to: string): Promise<void> {
        try {
            const chatId = this.formatTo(to);
            if (!isNaN(chatId) && TelegramProvider.bot) {
                await TelegramProvider.bot.telegram.sendChatAction(chatId, 'typing');
            }
        } catch (e) { }
    }

    async downloadMedia(mediaUrl: string): Promise<Buffer> {
        try {
            if (!TelegramProvider.bot) throw new Error('Bot not running');
            const fileLink = await TelegramProvider.bot.telegram.getFileLink(mediaUrl);
            const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
            return Buffer.from(response.data);
        } catch (e: any) {
            throw new Error(`Failed to download Telegram media: ${e.message}`);
        }
    }

    async parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any; userName?: string }> {
        try {
            if (!body.ctx) return { sender: '', message: '' };
            const ctx: Context = body.ctx;

            const chatId = ctx.from?.id;
            if (!chatId) return { sender: '', message: '' };

            const sender = `telegram:${chatId}`;
            const firstName = String((ctx.from as any)?.first_name || '').trim();
            const lastName = String((ctx.from as any)?.last_name || '').trim();
            const usernameHandle = String((ctx.from as any)?.username || '').trim();
            const displayFromNames = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
            const userName = displayFromNames || (usernameHandle ? `@${usernameHandle}` : undefined);
            let message = '';
            let mediaUrl = undefined;
            let mediaContentType = undefined;
            let interactiveData = undefined;

            if (body.type === 'message') {
                const msg = ctx.message as any;
                if (msg.text) {
                    message = msg.text;
                } else if (msg.document) {
                    mediaUrl = msg.document.file_id;
                    mediaContentType = msg.document.mime_type || 'application/pdf';
                } else if (msg.photo && msg.photo.length > 0) {
                    const photo = msg.photo[msg.photo.length - 1];
                    mediaUrl = photo.file_id;
                    mediaContentType = 'image/jpeg';
                } else if (msg.contact && msg.contact.phone_number) {
                    const cleaned = msg.contact.phone_number.replace(/^\+?91/, '').replace(/\D/g, '');
                    message = `__phone__:${cleaned}`;

                    // Auto-dismiss the Telegram reply keyboard immediately
                    try {
                        if (TelegramProvider.bot && chatId) {
                            await TelegramProvider.bot.telegram.sendMessage(
                                chatId,
                                'Phone number received! Generating your payment link...',
                                { reply_markup: { remove_keyboard: true } } as any
                            );
                        }
                    } catch (e) {}
                }
            } else if (body.type === 'callback') {
                const cbQuery = ctx.callbackQuery as any;
                message = cbQuery.data || '';
                if (cbQuery.message && cbQuery.message.message_id) {
                    interactiveData = { messageId: cbQuery.message.message_id };
                }
            }

            return { sender, message, mediaUrl, mediaContentType, interactiveData, userName };
        } catch (error) {
            this.logger.error('Failed to parse Telegram format', error);
            return { sender: '', message: '' };
        }
    }
}
