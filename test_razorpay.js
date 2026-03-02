require('dotenv').config();
const Razorpay = require('razorpay');

async function test() {
  const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'test_key',
      key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || 'test_secret',
  });

  try {
      const contactNo = 'whatsapp:+917842848278'.replace('whatsapp:', '');
      const res = await rzp.paymentLink.create({
          amount: 400,
          currency: 'INR',
          description: 'Test',
          customer: { contact: contactNo }
      });
      console.log(res);
  } catch (err) {
      console.error(err);
  }
}
test();
