const axios = require('axios');
const qs = require('querystring');
const crypto = require('crypto');

async function testE2E() {
    console.log("🚀 Starting E2E Flow test...");

    const sender = 'whatsapp:+13334445555';
    const baseUrl = 'http://localhost:3000';

    // Helper to send a simulated WhatsApp message
    const sendWA = async (body, mediaUrl = null, mediaType = null) => {
        let data = { From: sender, Body: body };
        if (mediaUrl) {
            data.NumMedia = '1';
            data.MediaUrl0 = mediaUrl;
            data.MediaContentType0 = mediaType;
        }
        console.log(`\n📱 Sending WA: ${body || '[Attachment]'}`);
        const res = await axios.post(`${baseUrl}/whatsapp`, qs.stringify(data), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true
        });
        console.log(`🤖 Bot Responded HTTP ${res.status}: ${res.data.substring(0, 100).replace(/\n/g, ' ')}...`);
    };

    // 1. Upload mock file 
    await sendWA('', 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'application/pdf');
    await new Promise(r => setTimeout(r, 1000));

    // 2. Select Copies
    await sendWA('1 Copy');
    await new Promise(r => setTimeout(r, 1000));

    // 3. Select Color
    await sendWA('Black & White');
    await new Promise(r => setTimeout(r, 1000));

    // 4. Select Sides (Triggers Razorpay Link Generation)
    await sendWA('Single Sided');
    await new Promise(r => setTimeout(r, 2000)); // wait extra bit for Link Gen

    // 5. Mock the Razorpay Webhook (payment_link.paid)
    console.log("\n💳 Simulating Razorpay Webhook Callback (payment_link.paid)...");
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';

    // Since we don't know the exact reference_id without hitting the DB/Session object directly from our test scripts,
    // we'll spoof a dummy webhook to Razorpay that includes the same phone number. The payment service 
    // extracts the phone number, gets the active session, looks up the session's reference ID, and successfully posts it.
    const mockWebhookBodyObj = {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_test123",
                    "reference_id": "we_will_ignore_this_as_it_uses_session",
                    "customer": {
                        "contact": "+13334445555"
                    }
                }
            }
        }
    };

    const bodyStr = JSON.stringify(mockWebhookBodyObj);
    const signature = crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');

    const webhookRes = await axios.post(`${baseUrl}/payment-webhook`, bodyStr, {
        headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': signature
        },
        validateStatus: () => true
    });
    console.log(`Webhook Accepted HTTP ${webhookRes.status}: ${JSON.stringify(webhookRes.data)}`);
    console.log(`\n✅ Background dummy printer should now trigger with terminal animation, and finally fire acknowledge!`);
}

testE2E().catch(console.error);
