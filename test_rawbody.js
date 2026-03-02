const crypto = require('crypto');
function testSig(secret, bodyBuffer, signature) {
  const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(bodyBuffer)
      .digest('hex');
  console.log(expectedSignature === signature);
}
