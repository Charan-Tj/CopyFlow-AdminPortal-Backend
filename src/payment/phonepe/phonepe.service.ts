import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';

type PaymentSource = 'web' | 'whatsapp' | 'telegram';

@Injectable()
export class PhonepeService {
    private readonly logger = new Logger(PhonepeService.name);

    private readonly merchantId = process.env.PHONEPE_MERCHANT_ID || 'TESTMERCHANT';
    private readonly saltKey = process.env.PHONEPE_SALT_KEY || 'test-salt-key';
    private readonly saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
    private readonly isProd = process.env.PHONEPE_ENV === 'production';
    private readonly baseUrl = this.isProd ? 'https://api.phonepe.com/apis/hermes' : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

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

    private getWebRedirect(referenceId: string, source: PaymentSource): string {
        const redirectBaseUrl = process.env.PHONEPE_REDIRECT_URL || 'https://copy-flow.app/print-order';
        const telegramReturn = process.env.PHONEPE_REDIRECT_TELEGRAM_URL || 'https://t.me/CopyFlowDev_bot';

        return this.appendQuery(redirectBaseUrl, {
            job_id: referenceId,
            source,
            return_to: source === 'telegram' ? telegramReturn : undefined,
        });
    }

    private toAscii(value: string): string {
        return value.replace(/[^\x00-\x7F]/g, '');
    }

    private resolveRedirectUrl(source: PaymentSource, referenceId: string): string {
        const webRedirect = this.getWebRedirect(referenceId, source);

        if (source === 'whatsapp') {
            return process.env.PHONEPE_REDIRECT_WHATSAPP_URL
                || `https://wa.me/?text=${encodeURIComponent(`Payment successful. Order ID: ${referenceId}`)}`;
        }

        if (source === 'telegram') {
            // Always use web status redirect for Telegram, then provide a controlled
            // return-to-telegram action from the web page.
            return webRedirect;
        }

        return webRedirect;
    }

    async createPaymentLink(
        amount: number,
        referenceId: string,
        customerPhone: string,
        source: PaymentSource = 'web'
    ) {
        const callbackUrl = process.env.PHONEPE_CALLBACK_URL || `https://nonvisional-gleamingly-amie.ngrok-free.dev/payment-webhook/phonepe`;
        const redirectUrl = this.toAscii(this.resolveRedirectUrl(source, referenceId).trim());
        const safeCallbackUrl = this.toAscii(callbackUrl.trim());
        const normalizedPhone = (customerPhone || '').replace(/[^0-9+]/g, '');
        const digitsOnly = normalizedPhone.replace(/\+/g, '');
        const mobileNumber = /^\d{10,15}$/.test(digitsOnly) ? digitsOnly : undefined;

        const payload = {
            merchantId: this.merchantId,
            merchantTransactionId: referenceId,
            merchantUserId: `MUID_${referenceId}`.substring(0, 36), // deterministic ASCII id
            amount: Math.round(amount * 100), // amount in paise
            redirectUrl, // browser redirect after payment
            redirectMode: 'REDIRECT',
            callbackUrl: safeCallbackUrl, // S2S webhook
            ...(mobileNumber ? { mobileNumber } : {}),
            paymentInstrument: {
                type: 'PAY_PAGE'
            }
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        const apiEndpoint = '/pg/v1/pay';

        const checksum = crypto
            .createHash('sha256')
            .update(base64Payload + apiEndpoint + this.saltKey)
            .digest('hex');

        const xVerify = `${checksum}###${this.saltIndex}`;

        this.logger.log(
            `Creating PhonePe link for referenceId: ${referenceId}, source=${source}, callbackUrl=${safeCallbackUrl}, redirectUrl=${redirectUrl}, mobileNumber=${mobileNumber || 'omitted'}`,
        );

        try {
            const response = await axios.post(
                `${this.baseUrl}${apiEndpoint}`,
                { request: base64Payload },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-VERIFY': xVerify,
                    }
                }
            );

            if (response.data?.success && response.data?.data?.instrumentResponse?.redirectInfo) {
                return response.data.data.instrumentResponse.redirectInfo.url;
            } else {
                this.logger.error(`PhonePe error: ${JSON.stringify(response.data)}`);
                throw new Error('Could not parse PhonePe response URL');
            }
        } catch (error: any) {
            const errorData = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`PhonePe link creation failed: ${errorData}`);
            throw error;
        }
    }

    verifyWebhookSignature(base64Body: string, xVerify: string): boolean {
        const expectedChecksum = crypto
            .createHash('sha256')
            .update(base64Body + this.saltKey)
            .digest('hex');

        const expectedXVerify = `${expectedChecksum}###${this.saltIndex}`;
        return xVerify === expectedXVerify;
    }

    async checkOrderStatus(orderId: string): Promise<boolean> {
        const endpoint = `/pg/v1/status/${this.merchantId}/${orderId}`;
        const checksum = crypto
            .createHash('sha256')
            .update(endpoint + this.saltKey)
            .digest('hex');

        const xVerify = `${checksum}###${this.saltIndex}`;

        try {
            const response = await axios.get(`${this.baseUrl}${endpoint}`, {
                headers: {
                    'X-VERIFY': xVerify,
                    'X-MERCHANT-ID': this.merchantId,
                    Accept: 'application/json',
                },
            });

            const body = response.data || {};
            const code = body.code || body.data?.responseCode;
            const state = body.data?.state;
            this.logger.log(`PhonePe status for ${orderId}: success=${body.success}, code=${code}, state=${state}`);

            return body.success === true && (
                code === 'PAYMENT_SUCCESS' ||
                code === 'SUCCESS' ||
                state === 'COMPLETED'
            );
        } catch (error: any) {
            const errorData = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.warn(`PhonePe status check failed for ${orderId}: ${errorData}`);
            return false;
        }
    }
}
