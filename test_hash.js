const crypto = require('crypto');
console.log(crypto.createHmac('sha256', 'test_webhook_secret').update('{"event":"payment.captured"}').digest('hex'));
