const crypto = require('crypto');
const axios = require('axios');

const saltKey = process.env.PHONEPE_SALT_KEY || 'test-salt-key';
const saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
const orderId = process.argv[2] || 'order_test_123';

const phonePeResponse = {
    success: true,
    code: 'PAYMENT_SUCCESS',
    message: 'Payment processed',
    data: {
        merchantTransactionId: orderId,
        transactionId: `txn_${Date.now()}`,
        amount: 5000,
        state: 'COMPLETED',
    },
};

const base64Response = Buffer.from(JSON.stringify(phonePeResponse)).toString('base64');
const checksum = crypto
    .createHash('sha256')
    .update(base64Response + saltKey)
    .digest('hex');
const xVerify = `${checksum}###${saltIndex}`;

console.log(`Sending PhonePe webhook for Order: ${orderId}`);
console.log(`X-VERIFY: ${xVerify}`);

axios
    .post(
        'http://localhost:3000/payment-webhook/phonepe',
        { response: base64Response },
        {
            headers: {
                'x-verify': xVerify,
                'Content-Type': 'application/json',
            },
        }
    )
    .then((res) => console.log('Response:', res.data))
    .catch((err) => console.error('Error:', err.response ? err.response.data : err.message));
