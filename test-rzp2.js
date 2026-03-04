require('dotenv').config();
const Razorpay = require('razorpay');

const rzp = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'test_key',
    key_secret: process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET || 'test_secret',
});

rzp.paymentLink.create({
    amount: 200,
    currency: 'INR',
    accept_partial: false,
    reference_id: `wa_${Date.now()}`,
    description: `Print job (1x single B&W)`,
    customer: {
        contact: '+919876543210',
    },
    notify: {
        sms: true,
        email: false,
    },
    reminder_enable: true,
    notes: {
        source: 'WhatsApp_Bot',
    }
}).then(console.log).catch(err => console.error("Error:", JSON.stringify(err, null, 2)));
