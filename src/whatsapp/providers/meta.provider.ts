import { Injectable, Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';

/**
 * Switch to this provider when migrating to Meta Cloud API
 * TODO: Implement all methods fully using Meta Graph API endpoints
 */
@Injectable()
export class MetaProvider implements WhatsappProvider {
    private readonly logger = new Logger(MetaProvider.name);

    constructor() {
        require('dotenv').config();
    }

    async sendTextMessage(to: string, body: string): Promise<void> {
        this.logger.warn('MetaProvider sendTextMessage not fully implemented yet');
        // TODO: Implement using Meta Graph API
        // axios.post(`https://graph.facebook.com/v17.0/${phone_number_id}/messages`, ...)
    }

    async sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void> {
        this.logger.warn('MetaProvider sendContentMessage not fully implemented yet');
        // TODO: Map abstract content types to Meta interactive message payloads
    }

    async sendTypingIndicator(to: string): Promise<void> {
        this.logger.warn('MetaProvider sendTypingIndicator not fully implemented yet');
        // TODO: Implement using Meta Graph API sender actions if supported/needed
    }

    parseIncomingWebhook(body: any): { sender: string; message: string; mediaUrl?: string; mediaContentType?: string } {
        // Parses Meta Cloud API webhook format:
        // { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from, text: { body }, type }] } }] }] }

        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const messageObj = changes?.value?.messages?.[0];

            if (!messageObj) {
                return { sender: '', message: '' };
            }

            const sender = messageObj.from;
            let message = '';

            if (messageObj.type === 'text') {
                message = messageObj.text?.body || '';
            }

            // TODO: Extract media URL using Meta Graph API for media messages
            // Will require making an API call to download the media using media ID
            let mediaUrl = undefined;
            let mediaContentType = undefined;

            return {
                sender,
                message,
                mediaUrl,
                mediaContentType
            };
        } catch (error) {
            this.logger.error('Failed to parse Meta webhook format', error);
            return { sender: '', message: '' };
        }
    }
}
