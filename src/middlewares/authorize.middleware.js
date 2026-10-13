const logger = require('../config/logger');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { Role } = require('../constants/roles');
const { getRequestMeta } = require('../utils/requestMeta.util');

const KNOWN_ROLES = new Set(Object.values(Role));

// The query string is left out of the log on purpose: it may carry tokens or personal data.
const logAuthorizationFailure = (req) =>
  logger.warn(
    {
      userId: req.user.id,
      role: req.user.role,
      method: req.method,
      url: req.originalUrl.split('?')[0],
      ipAddress: getRequestMeta(req).ipAddress,
      clientType: req.clientType,
      timestamp: new Date().toISOString(),
    },
    Messages.AUTHORIZATION_DENIED,
  );

// Must run after `authenticate`: it relies on req.user.role coming from the DB.
// A wrong role name is a coding mistake, so it throws when the route is registered.
const authorize = (...allowedRoles) => {
  const unknownRoles = allowedRoles.filter((role) => !KNOWN_ROLES.has(role));
  if (unknownRoles.length > 0) {
    throw new Error(`authorize: unknown role ${unknownRoles.map(String).join(', ')}`);
  }

  return (req, _res, next) => {
    if (!req.user) return next(createAppError(AppErrors.UNAUTHORIZED));
    if (!allowedRoles.includes(req.user.role)) {
      logAuthorizationFailure(req);
      return next(createAppError(AppErrors.FORBIDDEN));
    }
    return next();
  };
};

module.exports = { authorize };
