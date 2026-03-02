require('dotenv').config();
const Razorpay = require('razorpay');

async function test() {
  const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'test_key',
      key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || 'test_secret',
  });

  try {
      const contactNo = '+917842848278';
      const referenceId = `wa_${Date.now()}`;
      const res = await rzp.paymentLink.create({
          amount: 400,
          currency: 'INR',
          description: 'Print job (2x single B&W)',
          reference_id: referenceId,
          customer: { contact: contactNo },
          notify: { sms: true, email: false },
          reminder_enable: true,
          notes: { source: 'WhatsApp_Bot' }
      });
      console.log(res.short_url);
  } catch (err) {
      console.error(err);
  }
}
test();
