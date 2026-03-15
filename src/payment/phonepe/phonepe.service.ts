import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class PhonepeService {
    private readonly logger = new Logger(PhonepeService.name);

    private readonly merchantId = process.env.PHONEPE_MERCHANT_ID || 'TESTMERCHANT';
    private readonly saltKey = process.env.PHONEPE_SALT_KEY || 'test-salt-key';
    private readonly saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
    private readonly isProd = process.env.PHONEPE_ENV === 'production';
    private readonly baseUrl = this.isProd ? 'https://api.phonepe.com/apis/hermes' : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

    async createPaymentLink(amount: number, referenceId: string, customerPhone: string) {
        const callbackUrl = process.env.PHONEPE_CALLBACK_URL || `https://nonvisional-gleamingly-amie.ngrok-free.dev/payment-webhook/phonepe`;

        const payload = {
            merchantId: this.merchantId,
            merchantTransactionId: referenceId,
            merchantUserId: `MUID_${customerPhone || Date.now()}`.substring(0, 36), // max 36 chars
            amount: Math.round(amount * 100), // amount in paise
            redirectUrl: callbackUrl, // redirect back to server
            redirectMode: 'POST',
            callbackUrl: callbackUrl, // S2S webhook
            mobileNumber: customerPhone,
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

        this.logger.log(`Creating PhonePe link for referenceId: ${referenceId}`);

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
}
