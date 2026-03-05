import { Controller, Post, Get, Body, Query, Header, Logger, Inject } from '@nestjs/common';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import type { WhatsappProvider } from './providers/whatsapp-provider.interface';
import { WhatsappQueueService } from './whatsapp.queue';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: WhatsappProvider,
    private readonly whatsappQueue: WhatsappQueueService
  ) { }

  /**
   * Controller for Meta Webhook Verification
   * Accepts GET requests from Meta Developer Portal for webhook setup
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
   * Controller for WhatsApp Webhook
   * Accepts POST requests and interacts with BullMQ for async processing
   */
  @Post()
  @Header('Content-Type', 'text/xml')
  async handleIncomingMessage(@Body() body: any) {
    this.logger.log('Received webhook from WhatsApp Provider');

    // Parse the payload depending on the provider (Twilio, Meta, etc.)
    const parsedData = await this.whatsappProvider.parseIncomingWebhook(body);

    if (parsedData.sender) {
      // Enqueue the job for instant webhook 200 OK response
      await this.whatsappQueue.add('process-incoming', parsedData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });
      this.logger.log(`Added message from ${parsedData.sender} to processing queue`);
    } else {
      this.logger.warn('Failed to parse webhook payload or sender missing');
    }

    // Return empty TwiML or 200 OK equivalent to prevent provider timeouts. 
    // This is required for Twilio, and successfully returns 200 OK for standard JSON APIs like Meta.
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`.trim();
  }
}
