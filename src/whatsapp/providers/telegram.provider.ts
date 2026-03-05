import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';
import { Telegraf, Markup, Context } from 'telegraf';
import axios from 'axios';
import { WhatsappQueueService } from '../whatsapp.queue';

/**
 * Telegram Provider
 * Implements the WhatsappProvider interface to allow testing the CopyFlow backend via Telegram 
 * entirely for free without rate limits.
 */
@Injectable()
export class TelegramProvider implements WhatsappProvider, OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TelegramProvider.name);
    private static bot: Telegraf | null = null;
    private static isLaunched = false;

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
            // Re-setup listeners for the new instance 
            this.setupListeners();
        }
    }

    async onModuleInit() {
        if (TelegramProvider.bot && !TelegramProvider.isLaunched) {
            TelegramProvider.isLaunched = true; // Set lock BEFORE async call

            // Do NOT await launch()! It is an infinite long-polling process that blocks NestJS startup
            TelegramProvider.bot.launch({ dropPendingUpdates: true })
                .then(() => {
                    this.logger.log('🚀 Telegram Bot launched successfully (in background)');
                })
                .catch((e: any) => {
                    this.logger.error(`Telegram launch failed: ${e.message}`);
                    TelegramProvider.isLaunched = false;
                });

            this.logger.log('🚀 Telegram Provider initialized');
        }
    }

    async onModuleDestroy() {
        if (TelegramProvider.bot && TelegramProvider.isLaunched) {
            this.logger.log('Stopping Telegram Bot gracefully...');
            try {
                TelegramProvider.bot.stop('SIGINT');
            } catch (e) { }
            TelegramProvider.isLaunched = false;
        }
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
            const parsed = await this.parseIncomingWebhook({ type: 'callback', ctx });
            if (parsed.sender) {
                await this.queueService.add('process-incoming', parsed);
            }
            try {
                await ctx.answerCbQuery();
            } catch (e) { }
        });
    }

    private formatTo(to: string): number {
        return parseInt(to.replace('whatsapp:', '').replace('+', ''), 10);
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

            if (contentSid === 'cf_copies_list') {
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

    async parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any }> {
        // Since Telegram uses long polling built into Telegraf (not an explicit HTTP webhook),
        // we pass `{ type, ctx }` manually from our setupListeners method into this parser.

        try {
            if (!body.ctx) return { sender: '', message: '' };
            const ctx: Context = body.ctx;

            // Telegram uses chat IDs (numbers), but our backend treats them as phone strings.
            // We spoof the string to look like a Whatsapp Phone number so Razorpay accepts it.
            // Example: ChatId 1234567 -> sender will be "whatsapp:+1234567"
            const chatId = ctx.from?.id;
            if (!chatId) return { sender: '', message: '' };

            const sender = `whatsapp:+${chatId}`;
            let message = '';
            let mediaUrl = undefined;
            let mediaContentType = undefined;
            let interactiveData = undefined;

            if (body.type === 'message') {
                const msg = ctx.message as any;
                if (msg.text) {
                    message = msg.text;
                } else if (msg.document) {
                    // Telegram sends documents in a specific structure
                    mediaUrl = msg.document.file_id;
                    mediaContentType = msg.document.mime_type || 'application/pdf';
                } else if (msg.photo && msg.photo.length > 0) {
                    // Telegram sends multiple sizes of photos, we take the largest
                    const photo = msg.photo[msg.photo.length - 1];
                    mediaUrl = photo.file_id;
                    mediaContentType = 'image/jpeg';
                }
            } else if (body.type === 'callback') {
                const cbQuery = ctx.callbackQuery as any;
                // Treat button clicks exactly as text responses naturally!
                message = cbQuery.data || '';
            }

            return { sender, message, mediaUrl, mediaContentType, interactiveData };
        } catch (error) {
            this.logger.error('Failed to parse Telegram format', error);
            return { sender: '', message: '' };
        }
    }
}
