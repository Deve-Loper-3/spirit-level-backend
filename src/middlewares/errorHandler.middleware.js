const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');
const logger = require('../config/logger');
const { sendError } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');

const PRISMA_UNIQUE_VIOLATION = 'P2002';
// createAppError(status, message) falls back to this code; it tells the client nothing.
const GENERIC_ERROR_CODE = 'APP_ERROR';

const resolveUniqueConstraintMessage = (_target) => {
  return Messages.USER_ALREADY_EXISTS;
};

const errorHandler = (err, req, res, _next) => {
  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return sendError(res, {
      statusCode: 400,
      message: 'Malformed JSON in request body',
      code: AppErrors.VALIDATION_ERROR.code,
    });
  }

  // ZodError — validation failure
  if (err instanceof ZodError) {
    const errors = err.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return sendError(res, {
      statusCode: 400,
      message: Messages.VALIDATION_FAILED,
      code: AppErrors.VALIDATION_ERROR.code,
      errors,
    });
  }

  // Prisma unique-constraint violation
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
    const target = err.meta?.target;
    const message = resolveUniqueConstraintMessage(target);
    return sendError(res, {
      statusCode: 409,
      message,
      code: AppErrors.USER_ALREADY_EXISTS.code,
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const isOperational = Boolean(err.isOperational || err.expose);

  if (statusCode >= 500 || !isOperational) {
    logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled error');
  }

  if (isOperational) {
    const errors =
      err.errors ||
      (Array.isArray(err.details) ? err.details : err.details ? [err.details] : undefined);
    const code = err.code && err.code !== GENERIC_ERROR_CODE ? err.code : undefined;
    return sendError(res, { statusCode, message: err.message, code, errors });
  }

  // Unexpected / programmer error — reveal nothing to client
  return sendError(res, {
    statusCode: 500,
    message: Messages.INTERNAL_SERVER_ERROR,
    code: AppErrors.INTERNAL_SERVER_ERROR.code,
  });
};

module.exports = errorHandler;
