import { Injectable, Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';
import axios from 'axios';

/**
 * Meta Cloud API Provider
 */
@Injectable()
export class MetaProvider implements WhatsappProvider {
    private readonly logger = new Logger(MetaProvider.name);

    constructor() {
        require('dotenv').config();
    }

    private getHeaders() {
        const token = process.env.META_ACCESS_TOKEN;
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    private getApiUrl() {
        const phoneId = process.env.META_PHONE_NUMBER_ID;
        return `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    }

    private formatTo(to: string): string {
        // Meta requires clean international format without "whatsapp:" prefix or "+" sign
        return to.replace('whatsapp:', '').replace('+', '');
    }

    async sendTextMessage(to: string, body: string): Promise<void> {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: this.formatTo(to),
                type: 'text',
                text: { preview_url: false, body }
            };

            await axios.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
        } catch (error: any) {
            this.logger.error(`Error sending Meta text message: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void> {
        // Here we map the logical names we used in Twilio to Meta's native interactive formats.
        try {
            let interactivePayload: any = null;

            if (contentSid === 'cf_file_uploaded') {
                const { fileNum, pages, totalPages, fileCount } = variables || {};
                const bodyText = fileCount > 1
                    ? `✅ File ${fileNum} received — ${pages} page${pages > 1 ? 's' : ''}\n\n📁 Total: ${fileCount} files, ${totalPages} pages\n\nSend more files or tap Done to continue.`
                    : `✅ File received — ${pages} page${pages > 1 ? 's' : ''}\n\nSend more files or tap Done to continue.`;
                interactivePayload = {
                    type: "button",
                    body: { text: bodyText },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "done_uploading", title: "✅ Done — Print" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_copies_list') {
                interactivePayload = {
                    type: "list",
                    header: { type: "text", text: "Copies" },
                    body: { text: "How many copies of this document would you like?" },
                    footer: { text: "Select an option" },
                    action: {
                        button: "Select Copies",
                        sections: [
                            {
                                title: "Amount",
                                rows: [
                                    { id: "copies_1", title: "1 Copy", description: "One copy" },
                                    { id: "copies_2", title: "2 Copies", description: "Two copies" },
                                    { id: "copies_3", title: "3 Copies", description: "Three copies" },
                                    { id: "copies_other", title: "Other", description: "A different amount" }
                                ]
                            }
                        ]
                    }
                };
            } else if (contentSid === 'cf_color_quickrep') {
                interactivePayload = {
                    type: "button",
                    body: { text: "What type of print do you want?" },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "bw", title: "Black & White (₹2)" } },
                            { type: "reply", reply: { id: "color", title: "Color (₹10)" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_sides_quickrep') {
                interactivePayload = {
                    type: "button",
                    body: { text: "Would you like single-sided or double-sided printing?" },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "single", title: "Single Sided" } },
                            { type: "reply", reply: { id: "double", title: "Double Sided" } }
                        ]
                    }
                };
            } else {
                this.logger.warn(`Unknown contentSid: ${contentSid}`);
                await this.sendTextMessage(to, "Please reply manually to select your options.");
                return;
            }

            const payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: this.formatTo(to),
                type: 'interactive',
                interactive: interactivePayload
            };

            await axios.post(this.getApiUrl(), payload, { headers: this.getHeaders() });
        } catch (error: any) {
            this.logger.error(`Error sending Meta interactive message: ${error.response?.data?.error?.message || error.message}`);
            await this.sendTextMessage(to, "Please reply manually with your selection. (Interactive formatting failed)");
        }
    }

    async sendTypingIndicator(to: string): Promise<void> {
        // Meta API requires marking messages as read contextually, 
        // but there is no explicit "typing..." indicator endpoint for automated bots right now 
        // that works globally outside of handovers without custom tokens. 
        // We will just silently return for Meta as they handle read receipts automatically.
    }

    private async resolveMediaUrl(mediaId: string): Promise<string | undefined> {
        try {
            const token = process.env.META_ACCESS_TOKEN;
            // 1. Fetch media object to get the explicit URL
            const urlResult = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const directUrl = urlResult.data?.url;
            return directUrl;
        } catch (e: any) {
            this.logger.error(`Failed to resolve Meta media ID ${mediaId} to URL: ${e.response?.data?.error?.message || e.message}`);
            return undefined;
        }
    }

    async parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any }> {
        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const messageObj = changes?.value?.messages?.[0];

            if (!messageObj) {
                return { sender: '', message: '' };
            }

            // Always standardize back to the "whatsapp:+XXXXXXXXXXX" format that our app uses internally
            const sender = `whatsapp:+${messageObj.from}`;
            let message = '';
            let mediaUrl = undefined;
            let mediaContentType = undefined;
            let interactiveData = undefined;

            if (messageObj.type === 'text') {
                message = messageObj.text?.body || '';
            } else if (messageObj.type === 'interactive') {
                const interactive = messageObj.interactive;
                if (interactive.type === 'list_reply') {
                    message = interactive.list_reply.id;
                } else if (interactive.type === 'button_reply') {
                    message = interactive.button_reply.id;
                } else if (interactive.type === 'nfm_reply') {
                    // WhatsApp Native Flow JSON payload
                    try {
                        interactiveData = JSON.parse(interactive.nfm_reply.response_json);
                    } catch (e) {
                        this.logger.error("Failed to parse Meta NFM interactive JSON payload");
                    }
                }
            } else if (messageObj.type === 'document' || messageObj.type === 'image') {
                const mediaPayload = messageObj[messageObj.type];
                if (mediaPayload?.id) {
                    // Because WhatsApp service uses direct URLs to download internally, 
                    // we need to resolve the Graph API URL for it.
                    mediaUrl = await this.resolveMediaUrl(mediaPayload.id);
                    mediaContentType = mediaPayload.mime_type;
                }
            }

            return { sender, message, mediaUrl, mediaContentType, interactiveData };
        } catch (error) {
            this.logger.error('Failed to parse Meta webhook format', error);
            return { sender: '', message: '' };
        }
    }

    async downloadMedia(mediaUrl: string): Promise<Buffer> {
        const token = process.env.META_ACCESS_TOKEN;
        const response = await axios.get(mediaUrl, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${token}` },
            validateStatus: null
        });

        if (response.status !== 200) {
            throw new Error(`Failed to download Meta media: HTTP ${response.status}`);
        }

        return Buffer.from(response.data);
    }
}
