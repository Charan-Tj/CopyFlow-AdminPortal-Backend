import { Controller, Post, Get, Body, Query, Header, Logger, Inject, HttpCode } from '@nestjs/common';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import { WhatsappQueueService } from './whatsapp.queue';
import { TelegramProvider } from './providers/telegram.provider';
import { MetaProvider } from './providers/meta.provider';
import { TwilioProvider } from './providers/twilio.provider';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappQueue: WhatsappQueueService,
    private readonly telegramProvider: TelegramProvider,
    private readonly metaProvider: MetaProvider,
    private readonly twilioProvider: TwilioProvider
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
   * Auto-detects the format: Meta sends { object: 'whatsapp_business_account', entry: [...] }
   * Twilio sends form-encoded with Body, From, etc.
   */
  @Post()
  @Header('Content-Type', 'text/xml')
  async handleIncomingMessage(@Body() body: any) {
    this.logger.log('📩 Received WhatsApp webhook');

    // Auto-detect: Meta sends JSON with "object" field, Twilio sends form data
    const isMeta = body?.object === 'whatsapp_business_account';
    const provider: WhatsappProvider = isMeta ? this.metaProvider : this.twilioProvider;
    const providerName = isMeta ? 'Meta' : 'Twilio';

    this.logger.log(`Detected ${providerName} webhook format`);

    const parsedData = await provider.parseIncomingWebhook(body);

    if (parsedData.sender) {
      await this.whatsappQueue.add('process-incoming', parsedData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });
      this.logger.log(`Added ${providerName} message from ${parsedData.sender} to queue`);
    } else {
      this.logger.warn(`Failed to parse ${providerName} webhook payload or sender missing`);
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
