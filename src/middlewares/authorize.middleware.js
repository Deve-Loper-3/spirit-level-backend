const logger = require('../config/logger');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// Must run after `authenticate`: it relies on req.user.role coming from the DB.
const authorize =
  (...allowedRoles) =>
  (req, _res, next) => {
    if (!req.user) return next(createAppError(AppErrors.UNAUTHORIZED));
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        {
          userId: req.user.id,
          role: req.user.role,
          method: req.method,
          endpoint: req.originalUrl || req.url,
          ip: req.ip,
          timestamp: new Date().toISOString(),
        },
        'Authorization failure: unauthorized role access',
      );
      return next(createAppError(AppErrors.FORBIDDEN));
    }
    return next();
  };

module.exports = { authorize };
