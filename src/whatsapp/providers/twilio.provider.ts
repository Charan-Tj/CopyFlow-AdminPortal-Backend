import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';
import * as twilio from 'twilio';
import axios from 'axios';

@Injectable()
export class TwilioProvider implements WhatsappProvider, OnModuleInit {
    private readonly logger = new Logger(TwilioProvider.name);
    private twilioClient: twilio.Twilio;

    private templates: Record<string, string> = {};

    constructor() {
        require('dotenv').config();
        this.twilioClient = new twilio.Twilio(
            process.env.TWILIO_ACCOUNT_SID || 'ACtest',
            process.env.TWILIO_AUTH_TOKEN || 'testtoken'
        );
    }

    async onModuleInit() {
        await this.initTemplates();
    }

    private async initTemplates() {
        try {
            const contents = await this.twilioClient.content.v1.contents.list();

            const requiredTemplates = [
                {
                    friendlyName: 'cf_copies_list',
                    language: 'en',
                    types: {
                        'twilio/list-picker': {
                            body: 'How many copies of this document would you like?',
                            button: 'Select Copies',
                            items: [
                                { id: 'copies_1', item: '1 Copy', description: 'One copy' },
                                { id: 'copies_2', item: '2 Copies', description: 'Two copies' },
                                { id: 'copies_3', item: '3 Copies', description: 'Three copies' },
                                { id: 'copies_other', item: 'Other', description: 'A different amount' }
                            ]
                        }
                    } as any
                },
                {
                    friendlyName: 'cf_color_quickrep',
                    language: 'en',
                    types: {
                        'twilio/quick-reply': {
                            body: 'What type of print do you want?',
                            actions: [
                                { id: 'bw', title: 'Black & White ₹2/page'.substring(0, 20) },
                                { id: 'color', title: 'Color ₹10/page' }
                            ]
                        }
                    } as any
                },
                {
                    friendlyName: 'cf_sides_quickrep',
                    language: 'en',
                    types: {
                        'twilio/quick-reply': {
                            body: 'Would you like single-sided or double-sided printing?',
                            actions: [
                                { id: 'single', title: 'Single Sided' },
                                { id: 'double', title: 'Double Sided' }
                            ]
                        }
                    } as any
                }
            ];

            for (const tpl of requiredTemplates) {
                const existing = contents.find(c => c.friendlyName === tpl.friendlyName);
                if (existing) {
                    this.templates[tpl.friendlyName] = existing.sid;
                } else {
                    const newTpl = await this.twilioClient.content.v1.contents.create(tpl);
                    this.templates[tpl.friendlyName] = newTpl.sid;
                }
            }

            this.logger.log('Twilio Content API Templates initialized successfully.');
        } catch (e: any) {
            this.logger.error(`Failed to init templates: ${e.message}`);
        }
    }

    async sendShopSelector(to: string, nodes: { node_code: string; name: string; college: string; city: string }[]): Promise<void> {
        // Twilio wrapper currently uses basic text formatting for Shop Selector
        let msg = `*Available Print Shops* (${nodes.length})`;
        for (const n of nodes) {
            msg += `\n\n*${n.node_code}* — ${n.name}\n${n.college}, ${n.city}`;
        }
        msg += `\n\nReply: shop <code>   e.g. shop ${nodes[0]?.node_code || 'TEST01'}`;
        await this.sendTextMessage(to, msg);
    }

    async sendTextMessage(to: string, body: string): Promise<void> {
        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
        const from = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;

        await this.twilioClient.messages.create({
            body,
            from,
            to: to.includes('whatsapp:') ? to : `whatsapp:${to}`,
        });
    }

    /**
     * Send a quick-reply button message via Twilio Content API.
     * Creates a one-time content template and sends it immediately.
     * Falls back to plain text listing button labels if Content API fails.
     */
    async sendButtonMessage(
        to: string,
        body: string,
        buttons: { id: string; label: string }[],
        header?: string,
        footer?: string,
    ): Promise<void> {
        const fullText = [
            header ? `*${header}*` : '',
            body,
            footer ? `_${footer}_` : '',
        ].filter(Boolean).join('\n\n');

        try {
            const actions = buttons.slice(0, 3).map(b => ({
                id: b.id,
                title: b.label.slice(0, 20),
            }));

            const content = await this.twilioClient.content.v1.contents.create({
                friendlyName: `cf_btn_${Date.now()}`,
                language: 'en',
                types: {
                    'twilio/quick-reply': { body: fullText, actions },
                } as any,
            });

            const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
            const from = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;

            await this.twilioClient.messages.create({
                contentSid: content.sid,
                from,
                contentVariables: JSON.stringify({}),
                to: to.includes('whatsapp:') ? to : `whatsapp:${to}`,
            });
        } catch (err: any) {
            this.logger.warn(`sendButtonMessage via Content API failed, falling back to text: ${err.message}`);
            const btnList = buttons.map(b => b.label).join(' | ');
            await this.sendTextMessage(to, `${fullText}\n\n${btnList}`);
        }
    }

    async sendContentMessage(to: string, contentSid: string, variables: any = {}): Promise<void> {
        // Retrieve actual SID from map if contentSid is a friendly name like 'cf_copies_list'
        const actualSid = this.templates[contentSid] || contentSid;

        if (!actualSid) {
            this.logger.error('Content SID is not available. Ensure Twilio templates initialized properly.');
            await this.sendTextMessage(to, "Please select an option. (Interactive menus are currently unavailable, reply manually instead)");
            return;
        }

        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';
        const from = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;

        await this.twilioClient.messages.create({
            contentSid: actualSid,
            from,
            contentVariables: JSON.stringify(variables),
            to: to.includes('whatsapp:') ? to : `whatsapp:${to}`,
        });
    }

    async sendTypingIndicator(to: string): Promise<void> {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) return;

        const auth = Buffer.from(`${sid}:${token}`).toString('base64');
        const envFrom = process.env.TWILIO_PHONE_NUMBER || '+14155238886';

        const fromParam = envFrom.includes('whatsapp:') ? envFrom : `whatsapp:${envFrom}`;
        const toParam = to.includes('whatsapp:') ? to : `whatsapp:${to}`;

        try {
            const formData = new URLSearchParams();
            formData.append('To', toParam);
            formData.append('From', fromParam);
            formData.append('MessagingBinding.Action', 'typing_on');

            await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, formData, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                validateStatus: null
            });
        } catch (err: any) {
            this.logger.debug(`Failed to send typing indicator: ${err.message}`);
        }
    }

    async parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any; userName?: string }> {
        const sender = body.From;
        const bodyText = body.Body;
        const numMedia = parseInt(body.NumMedia, 10) || 0;

        let mediaUrl;
        let mediaContentType;
        if (numMedia > 0) {
            mediaUrl = body.MediaUrl0;
            mediaContentType = body.MediaContentType0;
        }

        let interactiveData;
        if (body.InteractiveData) {
            try {
                // InteractiveData comes in as a JSON string from Twilio when a WhatsApp Native Flow is complete
                interactiveData = JSON.parse(body.InteractiveData);
            } catch (e) {
                this.logger.error('Failed to parse InteractiveData JSON');
            }
        }

        return {
            sender,
            message: bodyText || '',
            mediaUrl,
            mediaContentType,
            interactiveData
        };
    }

    async downloadMedia(mediaUrl: string): Promise<Buffer> {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const auth = Buffer.from(`${sid}:${token}`).toString('base64');

        const response = await axios.get(mediaUrl, {
            responseType: 'arraybuffer',
            headers: sid && token ? { 'Authorization': `Basic ${auth}` } : {},
            validateStatus: null
        });

        if (response.status !== 200) {
            throw new Error(`Failed to download Twilio media: HTTP ${response.status}`);
        }

        return Buffer.from(response.data);
    }
}
