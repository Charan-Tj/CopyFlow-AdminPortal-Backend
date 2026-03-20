import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';
import axios from 'axios';

/**
 * Meta Cloud API Provider
 */
@Injectable()
export class MetaProvider implements WhatsappProvider, OnModuleInit {
    private readonly logger = new Logger(MetaProvider.name);
    private tokenValid = false;

    constructor() {
        require('dotenv').config();
    }

    async onModuleInit() {
        await this.validateToken();
    }

    /**
     * Validate Meta API credentials on startup so we get an immediate,
     * actionable error instead of silent failures for every message.
     */
    private async validateToken(): Promise<void> {
        const token = process.env.META_ACCESS_TOKEN;
        const phoneId = process.env.META_PHONE_NUMBER_ID;

        if (!token || !phoneId) {
            this.logger.error('⚠️  META_ACCESS_TOKEN or META_PHONE_NUMBER_ID is missing from .env — WhatsApp (Meta) will NOT work!');
            return;
        }

        try {
            const res = await axios.get(`https://graph.facebook.com/v18.0/${phoneId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                validateStatus: null,
            });

            if (res.status === 200) {
                this.tokenValid = true;
                const name = res.data?.verified_name || res.data?.display_phone_number || phoneId;
                this.logger.log(`✅ Meta WhatsApp API credentials valid — Phone: ${name}`);
            } else {
                const errMsg = res.data?.error?.message || `HTTP ${res.status}`;
                this.logger.error(`❌ Meta WhatsApp API credentials INVALID: ${errMsg}`);
                this.logger.error('👉 Go to https://developers.facebook.com/apps/ → WhatsApp → API Setup to generate a new System User token');
            }
        } catch (e: any) {
            this.logger.error(`❌ Failed to validate Meta token: ${e.message}`);
        }
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
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: this.formatTo(to),
            type: 'text',
            text: { preview_url: false, body }
        };

        try {
            const response = await axios.post(this.getApiUrl(), payload, {
                headers: this.getHeaders(),
                validateStatus: null,
            });

            if (response.status !== 200) {
                const errDetail = response.data?.error?.message || JSON.stringify(response.data);
                this.logger.error(`Meta API returned ${response.status}: ${errDetail}`);
                throw new Error(`Meta API error ${response.status}: ${errDetail}`);
            }
        } catch (error: any) {
            if (error.response) {
                const errDetail = error.response.data?.error?.message || error.message;
                this.logger.error(`Error sending Meta text message: ${errDetail}`);
                throw new Error(`Meta send failed: ${errDetail}`);
            }
            this.logger.error(`Error sending Meta text message: ${error.message}`);
            throw error;
        }
    }

    /**
     * Send a message with 1–3 quick-reply buttons (Meta interactive button message).
     * @param buttons max 3 items; each label must be ≤20 chars for Meta
     */
    async sendButtonMessage(
        to: string,
        body: string,
        buttons: { id: string; label: string }[],
        header?: string,
        footer?: string,
    ): Promise<void> {
        try {
            const metaButtons = buttons.slice(0, 3).map(b => ({
                type: 'reply',
                reply: { id: b.id, title: b.label.slice(0, 20) },
            }));

            const interactivePayload: any = {
                type: 'button',
                body: { text: body },
                action: { buttons: metaButtons },
            };
            if (header) interactivePayload.header = { type: 'text', text: header.slice(0, 60) };
            if (footer) interactivePayload.footer = { text: footer.slice(0, 60) };

            const payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: this.formatTo(to),
                type: 'interactive',
                interactive: interactivePayload,
            };

            const response = await axios.post(this.getApiUrl(), payload, {
                headers: this.getHeaders(),
                validateStatus: null,
            });

            if (response.status !== 200) {
                const errDetail = response.data?.error?.message || JSON.stringify(response.data);
                this.logger.error(`Meta button API returned ${response.status}: ${errDetail}`);
                // Fallback: plain text
                await this.sendTextMessage(to, `${body}\n\n${buttons.map(b => b.label).join(' | ')}`);
            }
        } catch (error: any) {
            this.logger.error(`Error sending Meta button message: ${error.message}`);
            await this.sendTextMessage(to, `${body}\n\n${buttons.map(b => b.label).join(' | ')}`);
        }
    }

    async sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void> {
        try {
            let interactivePayload: any;

            if (contentSid === 'cf_file_uploaded') {
                const { fileNum, pages, totalPages, fileCount } = variables || {};
                const bodyText = fileCount > 1
                    ? `✅ File ${fileNum} received — ${pages} page${pages > 1 ? 's' : ''}\n\n📁 Total so far: ${fileCount} files, ${totalPages} pages\n\n📌 Send more files, or tap Done when finished.`
                    : `✅ File received — ${pages} page${pages > 1 ? 's' : ''}\n\n📌 Send more files, or tap Done when finished.`;

                interactivePayload = {
                    type: "button",
                    body: { text: bodyText },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "done_uploading", title: "✅ Done" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_order_confirm') {
                interactivePayload = {
                    type: "button",
                    body: { text: variables?.summary || "Order Summary" },
                    footer: { text: "Tap Confirm to generate your payment link" },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "confirm_pay", title: "✅ Confirm & Pay" } },
                            { type: "reply", reply: { id: "edit_form", title: "✏️ Edit" } },
                            { type: "reply", reply: { id: "cancel", title: "❌ Cancel" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_copies_list') {
                interactivePayload = {
                    type: "list",
                    header: { type: "text", text: "🖨️ Step 2 of 4: Copies" },
                    body: { text: "How many copies of this document would you like?" },
                    footer: { text: "Tap to select" },
                    action: {
                        button: "Select Copies",
                        sections: [
                            {
                                title: "Quick pick",
                                rows: [
                                    { id: "copies_1", title: "1️⃣  1 Copy", description: "Print one copy" },
                                    { id: "copies_2", title: "2️⃣  2 Copies", description: "Print two copies" },
                                    { id: "copies_3", title: "3️⃣  3 Copies", description: "Print three copies" },
                                    { id: "copies_other", title: "🔢 Other", description: "Choose a custom amount" }
                                ]
                            }
                        ]
                    }
                };
            } else if (contentSid === 'cf_color_quickrep') {
                interactivePayload = {
                    type: "button",
                    header: { type: "text", text: "🎨 Step 3 of 4: Print Type" },
                    body: { text: "Choose between Black & White or Color printing:" },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "bw", title: "⬛ B&W — ₹2/page" } },
                            { type: "reply", reply: { id: "color", title: "🎨 Color — ₹10/page" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_sides_quickrep') {
                interactivePayload = {
                    type: "button",
                    header: { type: "text", text: "📄 Step 4 of 4: Print Sides" },
                    body: { text: "How do you want your pages printed?" },
                    action: {
                        buttons: [
                            { type: "reply", reply: { id: "single", title: "📄 Single Sided" } },
                            { type: "reply", reply: { id: "double", title: "📋 Double Sided" } }
                        ]
                    }
                };
            } else if (contentSid === 'cf_print_flow') {
                // WhatsApp Native Flow — opens a full-screen print settings form
                await this.sendFlowMessage(to);
                return;
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

            const response = await axios.post(this.getApiUrl(), payload, {
                headers: this.getHeaders(),
                validateStatus: null,
            });

            if (response.status !== 200) {
                const errDetail = response.data?.error?.message || JSON.stringify(response.data);
                this.logger.error(`Meta interactive API returned ${response.status}: ${errDetail}`);
                // Fall back to plain text on interactive failure
                await this.sendTextMessage(to, "Please reply manually with your selection. (Interactive formatting failed)");
            }
        } catch (error: any) {
            this.logger.error(`Error sending Meta interactive message: ${error.response?.data?.error?.message || error.message}`);
            // Use a simple fallback that doesn't call sendTextMessage again to avoid infinite recursion
            try {
                const payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: this.formatTo(to),
                    type: 'text',
                    text: { preview_url: false, body: "Please reply manually with your selection." }
                };
                await axios.post(this.getApiUrl(), payload, { headers: this.getHeaders(), validateStatus: null });
            } catch (fallbackErr) {
                this.logger.error(`Fallback text also failed for ${to}`);
            }
        }
    }

    async sendTypingIndicator(to: string): Promise<void> {
        // Meta API doesn't have a direct "typing" indicator for business bots.
        // We silently return — this is expected behavior.
    }

    /**
     * Send a WhatsApp Native Flow message.
     * Opens a full-screen interactive form in WhatsApp where the user
     * selects prints settings (copies, color, sides) in one shot.
     *
     * Requires a published WhatsApp Flow with ID set in META_FLOW_ID env var.
     * Falls back to the standard button-based flow if no flow ID is configured.
     */
    async sendFlowMessage(to: string): Promise<void> {
        const flowId = process.env.META_FLOW_ID;

        if (!flowId) {
            // No Flow ID configured — fall back to standard interactive buttons
            this.logger.warn('META_FLOW_ID not set — falling back to standard interactive copy/color/sides buttons');
            await this.sendContentMessage(to, 'cf_copies_list');
            return;
        }

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: this.formatTo(to),
            type: 'interactive',
            interactive: {
                type: 'flow',
                header: { type: 'text', text: 'Print Settings' },
                body: { text: 'Fill in your print preferences below. We will generate your payment link once you submit.' },
                footer: { text: 'CopyFlow - Cloud Print Network' },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: `cf_flow_${Date.now()}`,
                        flow_id: flowId,
                        flow_cta: 'Open Print Form',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: 'PRINT_SETTINGS'
                        }
                    }
                }
            }
        };

        try {
            const response = await axios.post(this.getApiUrl(), payload, {
                headers: this.getHeaders(),
                validateStatus: null,
            });

            if (response.status !== 200) {
                const errDetail = response.data?.error?.message || JSON.stringify(response.data);
                const errData = response.data?.error?.error_data ? JSON.stringify(response.data.error.error_data) : '';
                this.logger.error(`Meta Flow API returned ${response.status}: ${errDetail} ${errData}`);
                // Fall back to standard interactive buttons
                this.logger.warn('Falling back to standard interactive buttons due to Flow API error');
                await this.sendContentMessage(to, 'cf_copies_list');
            } else {
                this.logger.log(`✅ WhatsApp Flow message sent to ${to}`);
            }
        } catch (error: any) {
            this.logger.error(`Error sending Meta Flow message: ${error.message}`);
            // Fall back to standard interactive buttons
            await this.sendContentMessage(to, 'cf_copies_list');
        }
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

    async parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any; userName?: string }> {
        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            const contact = value?.contacts?.[0];
            const userName = String(contact?.profile?.name || '').trim() || undefined;

            // Ignore status updates (delivery receipts, read receipts, etc.)
            if (value?.statuses) {
                this.logger.debug('Ignoring Meta status update (delivery/read receipt)');
                return { sender: '', message: '', userName };
            }

            const messageObj = value?.messages?.[0];

            if (!messageObj) {
                return { sender: '', message: '', userName };
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

            return { sender, message, mediaUrl, mediaContentType, interactiveData, userName };
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
