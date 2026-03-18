import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';

type PaymentSource = 'web' | 'whatsapp' | 'telegram';

@Injectable()
export class CashfreeService {
    private readonly logger = new Logger(CashfreeService.name);

    private readonly appId = process.env.CASHFREE_APP_ID || '';
    private readonly secretKey = process.env.CASHFREE_SECRET_KEY || '';
    private readonly isProd = process.env.CASHFREE_ENV === 'production';
    private readonly baseUrl = this.isProd ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

    private appendQuery(baseUrl: string, params: Record<string, string | undefined>): string {
        try {
            const url = new URL(baseUrl);
            Object.entries(params).forEach(([key, value]) => {
                if (value) {
                    url.searchParams.set(key, value);
                }
            });
            return url.toString();
        } catch {
            const serialized = Object.entries(params)
                .filter(([, value]) => !!value)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
                .join('&');
            if (!serialized) return baseUrl;
            return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${serialized}`;
        }
    }

    private resolveReturnUrl(source: PaymentSource, referenceId: string): string {
        if (source === 'whatsapp') {
            return process.env.CASHFREE_REDIRECT_WHATSAPP_URL
                || `https://wa.me/?text=${encodeURIComponent(`Payment successful. Order ID: ${referenceId}`)}`;
        }

        if (source === 'telegram') {
            const webReturnBase = process.env.CASHFREE_REDIRECT_URL || 'https://copy-flow.app/print-order';
            const telegramReturn = process.env.CASHFREE_REDIRECT_TELEGRAM_URL || 'https://t.me/CopyFlowDev_bot';
            return this.appendQuery(webReturnBase, {
                job_id: referenceId,
                source,
                return_to: telegramReturn,
            });
        }

        const webReturnBase = process.env.CASHFREE_REDIRECT_URL || 'https://copy-flow.app/print-order';
        return this.appendQuery(webReturnBase, {
            job_id: referenceId,
            source,
        });
    }

    async createPaymentLink(
        amount: number,
        referenceId: string,
        customerPhone: string,
        description: string,
        source: PaymentSource = 'web'
    ) {
        if (!this.appId || !this.secretKey) {
            this.logger.warn('Cashfree credentials not set, skipping link generation.');
            return null;
        }

        const returnUrl = this.resolveReturnUrl(source, referenceId);

        const payload = {
            order_id: referenceId,
            order_amount: amount,
            order_currency: 'INR',
            order_note: description || 'Print Job',
            customer_details: {
                customer_id: customerPhone.replace(/\+/, '') || 'cust_default',
                customer_phone: customerPhone,
            },
            order_meta: {
                return_url: returnUrl,
            },
        };

        this.logger.log(`Creating Cashfree order for referenceId: ${referenceId}`);

        try {
            const response = await axios.post(
                `${this.baseUrl}/orders`,
                payload,
                {
                    headers: {
                        'x-client-id': this.appId,
                        'x-client-secret': this.secretKey,
                        'x-api-version': '2022-01-01',
                        'Content-Type': 'application/json',
                    }
                }
            );

            if (response.data && response.data.payment_link) {
                return response.data.payment_link;
            } else if (response.data && response.data.payment_session_id) {
                // Fallback direct checkout link if payment_link isn't present
                return `https://payments.cashfree.com/order/#${response.data.payment_session_id}`;
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

    async checkOrderStatus(orderId: string): Promise<boolean> {
        if (!this.appId || !this.secretKey) return false;

        try {
            const response = await axios.get(`${this.baseUrl}/orders/${orderId}`, {
                headers: {
                    'x-client-id': this.appId,
                    'x-client-secret': this.secretKey,
                    'x-api-version': '2022-01-01',
                },
            });
            return response.data?.order_status === 'PAID';
        } catch (error) {
            return false;
        }
    }
}
