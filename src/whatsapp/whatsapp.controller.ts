import { Controller, Post, Get, Body, Query, Header, Logger, Inject, HttpCode } from '@nestjs/common';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import { WhatsappQueueService } from './whatsapp.queue';
import { TelegramProvider } from './providers/telegram.provider';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: WhatsappProvider,
    private readonly whatsappQueue: WhatsappQueueService,
    private readonly telegramProvider: TelegramProvider
  ) { }

  /**
   * Meta Webhook Verification (GET)
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string
  ) {
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta Webhook Verified Successfully');
      return challenge;
    }
    this.logger.warn('Failed to verify Meta webhook due to missing or invalid token');
    return 'Verification failed';
  }

  /**
   * Twilio/Meta WhatsApp Webhook (POST)
   */
  @Post()
  @Header('Content-Type', 'text/xml')
  async handleIncomingMessage(@Body() body: any) {
    this.logger.log('Received webhook from WhatsApp Provider');

    const parsedData = await this.whatsappProvider.parseIncomingWebhook(body);

    if (parsedData.sender) {
      await this.whatsappQueue.add('process-incoming', parsedData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });
      this.logger.log(`Added message from ${parsedData.sender} to processing queue`);
    } else {
      this.logger.warn('Failed to parse webhook payload or sender missing');
    }

    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`.trim();
  }

  /**
   * Telegram Webhook Endpoint (POST)
   * Telegram sends updates here instead of us polling.
   * Must return 200 quickly or Telegram will retry.
   */
  @Post('telegram-webhook')
  @HttpCode(200)
  async handleTelegramWebhook(@Body() body: any) {
    this.logger.log('📩 Received Telegram webhook update');
    try {
      await this.telegramProvider.handleWebhookUpdate(body);
    } catch (e: any) {
      this.logger.error(`Error processing Telegram webhook: ${e.message}`);
    }
    return { ok: true };
  }
}
