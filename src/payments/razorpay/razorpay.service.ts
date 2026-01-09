import { Injectable, Logger } from '@nestjs/common';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayService {
    private razorpay: Razorpay;
    private readonly logger = new Logger(RazorpayService.name);

    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID || 'test_key',
            key_secret: process.env.RAZORPAY_SECRET || 'test_secret',
        });
    }

    async createOrder(amount: number, currency: string, receipt: string) {
        const options = {
            amount: Math.round(amount * 100), // Razorpay expects amount in paise
            currency,
            receipt,
        };
        return this.razorpay.orders.create(options);
    }

    verifyWebhookSignature(body: string, signature: string): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            this.logger.error('RAZORPAY_WEBHOOK_SECRET is not defined');
            return false;
        }

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');

        return expectedSignature === signature;
    }
}
