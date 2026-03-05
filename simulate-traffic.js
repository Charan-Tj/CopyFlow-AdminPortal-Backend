const axios = require('axios');

async function run() {
    console.log('Sending 50 concurrent WhatsApp requests to simulate traffic spike...');

    const targetUrl = 'http://localhost:3000/whatsapp';
    const promises = [];

    for (let i = 0; i < 50; i++) {
        const phoneNumber = `whatsapp:+91999999${i.toString().padStart(4, '0')}`;

        // Twilio-like payload
        const payload = new URLSearchParams();
        payload.append('SmsMessageSid', `SMfake${i}`);
        payload.append('NumMedia', '0');
        payload.append('To', 'whatsapp:+14155238886');
        payload.append('From', phoneNumber);
        payload.append('Body', 'hi'); // User says hi

        const p = axios.post(targetUrl, payload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(res => {
            // console.log(`✓ Sent for ${phoneNumber}`, res.status);
        }).catch(err => {
            console.error(`✗ Error for ${phoneNumber}`, err.message);
        });

        promises.push(p);
    }

    await Promise.all(promises);
    console.log('All 50 webhooks sent. Checking queue...');

    // Wait a moment for queue to process
    setTimeout(async () => {
        try {
            // Assuming we can get admin token or we just show instructions.
            console.log('Open http://localhost:3001/dashboard/queue to see the queue draining!');
        } catch (e) {
            console.error(e.message);
        }
    }, 2000);
}

run();
