const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// Must run after `authenticate`: it relies on req.user.role coming from the DB.
const authorize =
  (...allowedRoles) =>
  (req, _res, next) => {
    if (!req.user) return next(createAppError(AppErrors.UNAUTHORIZED));
    if (!allowedRoles.includes(req.user.role)) return next(createAppError(AppErrors.FORBIDDEN));
    return next();
  };

module.exports = { authorize };
