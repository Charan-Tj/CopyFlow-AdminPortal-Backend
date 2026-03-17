import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class CashfreeService {
    private readonly logger = new Logger(CashfreeService.name);

    private readonly appId = process.env.CASHFREE_APP_ID || '';
    private readonly secretKey = process.env.CASHFREE_SECRET_KEY || '';
    private readonly isProd = process.env.CASHFREE_ENV === 'production';
    private readonly baseUrl = this.isProd ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

    async createPaymentLink(amount: number, referenceId: string, customerPhone: string, description: string) {
        if (!this.appId || !this.secretKey) {
            this.logger.warn('Cashfree credentials not set, skipping link generation.');
            return null;
        }

        const payload = {
            link_id: referenceId,
            link_amount: amount,
            link_currency: 'INR',
            link_purpose: description || 'Print Job',
            customer_details: {
                customer_phone: customerPhone,
            },
            link_notify: {
                send_sms: false,
                send_email: false
            }
        };

        this.logger.log(`Creating Cashfree link for referenceId: ${referenceId}`);

        try {
            const response = await axios.post(
                `${this.baseUrl}/links`,
                payload,
                {
                    headers: {
                        'x-client-id': this.appId,
                        'x-client-secret': this.secretKey,
                        'x-api-version': '2023-08-01',
                        'Content-Type': 'application/json',
                    }
                }
            );

            if (response.data && response.data.link_url) {
                return response.data.link_url;
            } else {
                this.logger.error(`Cashfree error: ${JSON.stringify(response.data)}`);
                throw new Error('Could not parse Cashfree response URL');
            }
        } catch (error: any) {
            const errorData = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`Cashfree link creation failed: ${errorData}`);
            throw error;
        }
    }

    verifyWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
        if (!this.secretKey) return false;

        try {
            const expectedSignature = crypto
                .createHmac('sha256', this.secretKey)
                .update(timestamp + rawBody)
                .digest('base64');

            return signature === expectedSignature;
        } catch (error) {
            return false;
        }
    }
}
