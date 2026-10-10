const { createAppError } = require('../errors/AppError');

const notFound = (req, res, next) => {
  next(createAppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
};

module.exports = notFound;
