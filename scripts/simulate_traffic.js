const axios = require('axios');
const querystring = require('querystring');

async function run() {
    console.log('Sending 15 concurrent requests to simulate high WhatsApp webhook traffic...');

    // Create an array to track response times and status
    const results = [];

    const requests = Array.from({ length: 15 }).map(async (_, i) => {
        const payload = querystring.stringify({
            From: `whatsapp:+123456789${i.toString().padStart(2, '0')}`,
            Body: `Load test message from user ${i}`,
            NumMedia: '0'
        });

        const startTime = Date.now();
        try {
            const res = await axios.post('http://localhost:3000/whatsapp', payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 5000
            });
            const duration = Date.now() - startTime;
            results.push({ job: i, status: res.status, time: duration });
            console.log(`✅ [HTTP ${res.status}] Request ${parseInt(i) + 1} accepted in ${duration}ms!`);
        } catch (err) {
            const duration = Date.now() - startTime;
            results.push({ job: i, error: err.message, time: duration });
            console.error(`❌ Request ${i + 1} failed after ${duration}ms: ${err.message}`);
        }
    });

    await Promise.all(requests);
    console.log('\n--- TRAFFIC SIMULATION RESULTS ---');
    console.table(results);
    console.log('Finished enqueueing jobs. Check NestJS server logs to see BullMQ processing them async!');
}

run();
