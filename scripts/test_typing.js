require('dotenv').config();
const twilio = require('twilio');

async function test() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);

  try {
    // Attempting to send WhatsApp typing indicator using standard Twilio API
    const msg = await client.messages.create({
       body: "",
       from: 'whatsapp:+14155238886',
       to: 'whatsapp:+917842584827',
       statusCallback: undefined
     });
    console.log("Success! SID:", msg.sid);
  } catch(e) {
    console.error("Twilio Error:", e.message);
  }
}
test();
