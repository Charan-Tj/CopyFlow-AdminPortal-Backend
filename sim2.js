const axios = require('axios');
const qs = require('querystring');

async function run() {
  const url = 'http://localhost:3000/whatsapp';
  const sender = 'whatsapp:+19999999999';

  const send = async (body, media = {}) => {
    let data = { From: sender, Body: body, ...media };
    const res = await axios.post(url, qs.stringify(data), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    });
    console.log(`Sent: ${body} -> HTTP ${res.status}:`, res.data);
  };

  await send('Single Sided');
}
run().catch(err => console.error(err));
