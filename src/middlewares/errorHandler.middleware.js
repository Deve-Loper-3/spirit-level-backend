const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');
const logger = require('../config/logger');
const { sendError } = require('../utils/apiResponse.util');
const { toFieldErrors } = require('../utils/validationError.util');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');
const {
  isUniqueConstraintError,
  isRecordNotFoundError,
  isRestrictViolationError,
} = require('../utils/prismaError.util');

// createAppError(status, message) falls back to this code; it tells the client nothing.
const GENERIC_ERROR_CODE = 'APP_ERROR';

const sendAppError = (res, errorDef) =>
  sendError(res, {
    statusCode: errorDef.statusCode,
    message: errorDef.message,
    code: errorDef.code,
  });

const errorHandler = (err, req, res, _next) => {
  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return sendError(res, {
      statusCode: AppErrors.VALIDATION_ERROR.statusCode,
      message: Messages.MALFORMED_JSON,
      code: AppErrors.VALIDATION_ERROR.code,
    });
  }

  // Body larger than the json() limit
  if (err.type === 'entity.too.large') {
    return sendAppError(res, AppErrors.PAYLOAD_TOO_LARGE);
  }

  // ZodError — validation failure
  if (err instanceof ZodError) {
    return sendError(res, {
      statusCode: AppErrors.VALIDATION_ERROR.statusCode,
      message: Messages.VALIDATION_FAILED,
      code: AppErrors.VALIDATION_ERROR.code,
      errors: toFieldErrors(err.issues),
    });
  }

  // Safety nets for Prisma errors a service did not map itself. Services that know which record
  // is involved throw their own error (USER_ALREADY_EXISTS, CATEGORY_NOT_FOUND, ...) first.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (isUniqueConstraintError(err)) return sendAppError(res, AppErrors.RESOURCE_ALREADY_EXISTS);
    if (isRecordNotFoundError(err)) return sendAppError(res, AppErrors.RESOURCE_NOT_FOUND);
  }

  // Postgres RESTRICT foreign key violation
  if (isRestrictViolationError(err)) {
    return sendAppError(res, AppErrors.RESOURCE_IN_USE);
  }

  const statusCode = err.statusCode || err.status || 500;
  const isOperational = Boolean(err.isOperational || err.expose);

  if (statusCode >= 500 || !isOperational) {
    logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled error');
  }

  if (isOperational) {
    const errors = err.errors || (Array.isArray(err.details) ? err.details : undefined);
    const details =
      err.details && !Array.isArray(err.details) && typeof err.details === 'object'
        ? err.details
        : undefined;
    const code = err.code && err.code !== GENERIC_ERROR_CODE ? err.code : undefined;
    return sendError(res, { statusCode, message: err.message, code, errors, details });
  }

  // Unexpected / programmer error — reveal nothing to client
  return sendError(res, {
    statusCode: 500,
    message: Messages.INTERNAL_SERVER_ERROR,
    code: AppErrors.INTERNAL_SERVER_ERROR.code,
  });
};

module.exports = errorHandler;
