const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { publicLimiter } = require('./rateLimiter.middleware');

// For a route that exists but not for this HTTP method: 405 with the allowed methods in `Allow`.
// The result is a middleware list (IP rate limit first), which Express accepts wherever a handler goes.
const methodNotAllowed = (allowedMethods) => [
  publicLimiter,
  (_req, res, next) => {
    res.set('Allow', allowedMethods.join(', '));
    next(createAppError(AppErrors.METHOD_NOT_ALLOWED));
  },
];

module.exports = { methodNotAllowed };
