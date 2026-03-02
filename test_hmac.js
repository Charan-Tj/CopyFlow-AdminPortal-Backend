const crypto = require('crypto');
function v(body, sig, secret) {
  const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return expectedSignature === sig;
}
console.log(v('{"a":1}', 'fb41aec1877bbc80b7088456f613a1a3b51863edb03303b903264a47ac8ff9e0', 'test_webhook_secret'));
