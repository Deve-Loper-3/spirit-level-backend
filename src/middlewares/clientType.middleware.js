const env = require('../config/env');
const { detectClientType } = require('../utils/clientType.util');

// Sets req.clientType ('web' | 'mobile' | 'unknown') for logging only (not a security signal).
const clientType = (req, _res, next) => {
  req.clientType = detectClientType({
    userAgent: req.get('user-agent'),
    origin: req.get('origin'),
    allowedOrigins: env.corsOrigins,
  });
  next();
};

module.exports = clientType;
