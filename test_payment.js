const axios = require('axios');
const crypto = require('crypto');

const secret = 'test_webhook_secret';
const payload = {
    event: 'payment_link.paid',
    payload: {
        payment_link: {
            entity: {
                reference_id: 'wa_123'
            }
        },
        payment: {
            entity: {
                id: 'pay_123',
                amount: 1000,
                status: 'captured',
                notes: {
                    reference_id: 'wa_123'
                },
                contact: 'whatsapp:+919999999999'
            }
        }
    }
};

const bodyStr = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

axios.post('http://localhost:3000/payment-webhook', payload, {
    headers: {
        'x-razorpay-signature': signature
    }
}).then(res => console.log(res.data)).catch(err => console.error(err.response ? err.response.data : err.message));
