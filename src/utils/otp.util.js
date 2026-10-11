const crypto = require('crypto');

const OTP_LENGTH = 4;

// Cryptographically secure 4-digit code, zero-padded (e.g. "0042").
const generateOtp = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

module.exports = { generateOtp, OTP_LENGTH };
