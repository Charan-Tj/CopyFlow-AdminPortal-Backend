const crypto = require('crypto');
const axios = require('axios');

const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
const orderId = process.argv[2] || 'order_test_123';
const jobId = process.argv[3] || 'job_test_123';

const payload = {
    "entity": "event",
    "account_id": "acc_test",
    "event": "order.paid",
    "contains": [
        "payment",
        "order"
    ],
    "payload": {
        "payment": {
            "entity": {
                "id": "pay_test_123",
                "entity": "payment",
                "amount": 5000,
                "currency": "INR",
                "status": "captured",
                "order_id": orderId,
                "method": "card"
            }
        },
        "order": {
            "entity": {
                "id": orderId,
                "entity": "order",
                "amount": 5000,
                "amount_paid": 5000,
                "amount_due": 0,
                "currency": "INR",
                "receipt": "receipt_123",
                "status": "paid",
                "attempts": 1
            }
        }
    },
    "created_at": 1612345678
};

const body = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

console.log(`Sending Webhook for Order: ${orderId}`);
console.log(`Signature: ${signature}`);

axios.post('http://localhost:3000/webhooks/razorpay', payload, {
    headers: {
        'x-razorpay-signature': signature,
        'Content-Type': 'application/json'
    }
})
    .then(res => console.log('Response:', res.data))
    .catch(err => console.error('Error:', err.response ? err.response.data : err.message));
