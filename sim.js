const axios = require('axios');
const qs = require('querystring');

async function run() {
  const url = 'http://localhost:3000/whatsapp';
  const sender = 'whatsapp:+19999999999';

  const send = async (body, media = {}) => {
    let data = { From: sender, Body: body, ...media };
    const res = await axios.post(url, qs.stringify(data), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    console.log(`Sent: ${body} -> Response:`, res.data);
  };

  // 1. Send file
  await send('', { NumMedia: '1', MediaUrl0: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', MediaContentType0: 'application/pdf' });
  // Wait a sec for states to settle just in case
  await new Promise(r => setTimeout(r, 1000));
  // 2. Copies
  await send('1 Copy');
  await new Promise(r => setTimeout(r, 1000));
  // 3. Color
  await send('Black & White');
  await new Promise(r => setTimeout(r, 1000));
  // 4. Sides
  await send('Single Sided');
}
run().catch(err => console.error(err));
