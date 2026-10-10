const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TYPE = 'access';

const signAccessToken = ({ userId, role }) =>
  jwt.sign({ role, type: ACCESS_TOKEN_TYPE }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });

// Throws jsonwebtoken errors (JsonWebTokenError / TokenExpiredError) on any invalid token.
const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] });
  if (payload.type !== ACCESS_TOKEN_TYPE) {
    throw new jwt.JsonWebTokenError('invalid token type');
  }
  return payload;
};

module.exports = { signAccessToken, verifyAccessToken };
