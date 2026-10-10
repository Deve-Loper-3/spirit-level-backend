const crypto = require('crypto');

const REFRESH_TOKEN_BYTES = 32;

const generateRefreshToken = () => crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { generateRefreshToken, hashToken };
