import { Controller, Post, Body, Header, Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly whatsappService: WhatsappService) { }

  /**
   * Controller for Twilio WhatsApp Webhook
   * Accepts POST requests and interacts with the WhatsappService to handle the conversation
   */
  @Post()
  @Header('Content-Type', 'text/xml')
  async handleIncomingTwilioMessage(@Body() body: any) {
    this.logger.log('Received webhook from Twilio');

    // Twilio sends application/x-www-form-urlencoded data to the webhook
    const sender = body.From;
    const bodyText = body.Body;
    const numMedia = parseInt(body.NumMedia, 10) || 0;

    let mediaUrl;
    let mediaContentType;
    if (numMedia > 0) {
      mediaUrl = body.MediaUrl0;
      mediaContentType = body.MediaContentType0;
    }

    const responseMessage = await this.whatsappService.handleIncomingMessage(
      sender,
      bodyText || '',
      mediaUrl,
      mediaContentType
    );

    if (!responseMessage) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`.trim();
    }

    // Return TwiML XML response as required by Twilio API format
    return `
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>${responseMessage}</Message>
      </Response>
    `.trim();
  }
}
