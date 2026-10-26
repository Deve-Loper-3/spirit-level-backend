const { sendError } = require('./apiResponse.util');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');

// 422 with every failing field.
const sendValidationFailed = (res, error) =>
  sendError(res, {
    statusCode: 422,
    message: Messages.VALIDATION_FAILED,
    code: AppErrors.VALIDATION_ERROR.code,
    errors: error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });

module.exports = { sendValidationFailed };
