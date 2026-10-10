const { AppErrors } = require('../constants/errors');

const createAppError = (statusCodeOrErrorDef, message, code = 'APP_ERROR', details) => {
  if (typeof statusCodeOrErrorDef === 'object' && statusCodeOrErrorDef !== null) {
    const { statusCode, message: defMessage, code: defCode } = statusCodeOrErrorDef;
    const error = new Error(message || defMessage);
    error.statusCode = statusCode;
    error.code = defCode || code;
    error.details = details;
    error.isOperational = true;
    Error.captureStackTrace(error, createAppError);
    return error;
  }

  const error = new Error(message);
  error.statusCode = statusCodeOrErrorDef;
  error.code = code;
  error.details = details;
  error.isOperational = true;
  Error.captureStackTrace(error, createAppError);
  return error;
};

module.exports = { createAppError, AppErrors };
