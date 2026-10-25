const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// For a route that exists but not for this HTTP method: 405 with the allowed methods in `Allow`.
const methodNotAllowed = (allowedMethods) => (_req, res, next) => {
  res.set('Allow', allowedMethods.join(', '));
  next(createAppError(AppErrors.METHOD_NOT_ALLOWED));
};

module.exports = { methodNotAllowed };
