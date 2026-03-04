const axios = require('axios');
const qs = require('querystring');

async function run() {
  const url = 'http://localhost:3000/whatsapp';
  const sender = 'whatsapp:+19988776655';

  const send = async (body, media = {}) => {
    let data = { From: sender, Body: body, ...media };
    try {
      const res = await axios.post(url, qs.stringify(data), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });
      console.log(`Sent: ${body} -> HTTP ${res.status}:`, res.data);
    } catch (err) {
      console.error(`Sent: ${body} -> ERROR:`, err.message);
    }
  };

  await send('', { NumMedia: '1', MediaUrl0: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', MediaContentType0: 'application/pdf' });
  await send('1 Copy');
  await send('Black & White');
  await send('Single Sided');
}
run();
