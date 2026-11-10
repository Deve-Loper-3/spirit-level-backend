const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// The message is fixed: it does not echo the requested URL back to the client.
const notFound = (_req, _res, next) => {
  next(createAppError(AppErrors.ROUTE_NOT_FOUND));
};

module.exports = notFound;
