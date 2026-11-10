const { sendError } = require('./apiResponse.util');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');

// Errors about the whole body or query (empty path) are reported under this field name.
const WHOLE_BODY_FIELD = 'body';

// Zod issues -> the `errors` array of the error envelope: [{ field, message }].
const toFieldErrors = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join('.') || WHOLE_BODY_FIELD,
    message: issue.message,
  }));

// 400 with every failing field.
const sendValidationFailed = (res, error) =>
  sendError(res, {
    statusCode: AppErrors.VALIDATION_ERROR.statusCode,
    message: Messages.VALIDATION_FAILED,
    code: AppErrors.VALIDATION_ERROR.code,
    errors: toFieldErrors(error.issues),
  });

module.exports = { sendValidationFailed, toFieldErrors, WHOLE_BODY_FIELD };
