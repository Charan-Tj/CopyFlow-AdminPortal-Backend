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
            [Markup.button.callback(`🏪 ${n.name} (${n.node_code})`, `shop_${n.node_code}`)]
        );

        try {
            await TelegramProvider.bot.telegram.sendMessage(
                chatId,
                '👋 Welcome to CopyFlow!\n\nSelect your print shop to get started:',
                Markup.inlineKeyboard(buttons)
            );
        } catch (error: any) {
            this.logger.error(`Error sending shop selector to ${to}: ${error.message}`);
        }
    }

    async sendTextMessage(to: string, body: string): Promise<void> {
        try {
            const chatId = this.formatTo(to);
            if (isNaN(chatId) || !TelegramProvider.bot) return;
            await TelegramProvider.bot.telegram.sendMessage(chatId, body);
        } catch (error: any) {
            this.logger.error(`Error sending Telegram msg: ${error.message}`);
        }
    }

    async sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void> {
        try {
            const chatId = this.formatTo(to);
            if (isNaN(chatId) || !TelegramProvider.bot) return;

            if (contentSid === 'cf_file_uploaded') {
                const { fileNum, pages, totalPages, fileCount } = variables || {};
                const summary = fileCount > 1
                    ? `✅ File ${fileNum} received — ${pages} page${pages > 1 ? 's' : ''}\n\n📁 Total: ${fileCount} files, ${totalPages} pages`
                    : `✅ File received — ${pages} page${pages > 1 ? 's' : ''}`;

                await TelegramProvider.bot.telegram.sendMessage(chatId, `${summary}\n\nSend more files or tap "Done" to continue.`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Done — Proceed to Print', 'done_uploading')],
                    ])
                );
            } else if (contentSid === 'cf_order_confirm') {
                await TelegramProvider.bot.telegram.sendMessage(chatId, variables?.summary || 'Order Summary',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Confirm & Pay', 'confirm_pay')],
                        [Markup.button.callback('✏️ Edit Form', 'edit_form')]
                    ])
                );
            } else if (contentSid === 'cf_copies_list') {
                await TelegramProvider.bot.telegram.sendMessage(chatId, 'How many copies of this document would you like?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('1 Copy', 'copies_1')],
                        [Markup.button.callback('2 Copies', 'copies_2')],
                        [Markup.button.callback('3 Copies', 'copies_3')],
                        [Markup.button.callback('Other', 'copies_other')]
                    ])
                );
            } else if (contentSid === 'cf_color_quickrep') {
                await TelegramProvider.bot.telegram.sendMessage(chatId, 'What type of print do you want?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('Black & White (₹2)', 'bw')],
                        [Markup.button.callback('Color (₹10)', 'color')]
                    ])
                );
            } else if (contentSid === 'cf_sides_quickrep') {
                await TelegramProvider.bot.telegram.sendMessage(chatId, 'Would you like single-sided or double-sided printing?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('Single Sided', 'single')],
                        [Markup.button.callback('Double Sided', 'double')]
                    ])
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
                }
            } else if (body.type === 'callback') {
                const cbQuery = ctx.callbackQuery as any;
                message = cbQuery.data || '';
            }

            return { sender, message, mediaUrl, mediaContentType, interactiveData, userName };
        } catch (error) {
            this.logger.error('Failed to parse Telegram format', error);
            return { sender: '', message: '' };
        }
    }
}
