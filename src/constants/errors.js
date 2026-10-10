const { Messages } = require('./messages');

const AppErrors = Object.freeze({
  USER_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.USER_NOT_FOUND,
    code: 'USER_NOT_FOUND',
  }),
  REGISTRATION_ALREADY_COMPLETED: Object.freeze({
    statusCode: 409,
    message: Messages.REGISTRATION_ALREADY_COMPLETED,
    code: 'REGISTRATION_ALREADY_COMPLETED',
  }),
  ACCOUNT_NOT_ELIGIBLE: Object.freeze({
    statusCode: 403,
    message: Messages.ACCOUNT_NOT_ELIGIBLE,
    code: 'ACCOUNT_NOT_ELIGIBLE',
  }),
  USER_ALREADY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.USER_ALREADY_EXISTS,
    code: 'USER_ALREADY_EXISTS',
  }),
  PHONE_ALREADY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.PHONE_ALREADY_EXISTS,
    code: 'PHONE_ALREADY_EXISTS',
  }),
  EMERGENCY_PHONE_SAME_AS_MEMBER: Object.freeze({
    statusCode: 400,
    message: Messages.EMERGENCY_PHONE_SAME_AS_MEMBER,
    code: 'EMERGENCY_PHONE_SAME_AS_MEMBER',
  }),
  FORBIDDEN: Object.freeze({
    statusCode: 403,
    message: Messages.FORBIDDEN,
    code: 'FORBIDDEN',
  }),
  TOO_MANY_REQUESTS: Object.freeze({
    statusCode: 429,
    message: Messages.TOO_MANY_REQUESTS,
    code: 'TOO_MANY_REQUESTS',
  }),
  INVALID_CREDENTIALS: Object.freeze({
    statusCode: 401,
    message: Messages.INVALID_CREDENTIALS,
    code: 'INVALID_CREDENTIALS',
  }),
  ACCOUNT_DISABLED: Object.freeze({
    statusCode: 403,
    message: Messages.ACCOUNT_DISABLED,
    code: 'ACCOUNT_DISABLED',
  }),
  REGISTRATION_INCOMPLETE: Object.freeze({
    statusCode: 403,
    message: Messages.REGISTRATION_INCOMPLETE,
    code: 'REGISTRATION_INCOMPLETE',
  }),
  STAFF_ROLE_NOT_ALLOWED: Object.freeze({
    statusCode: 403,
    message: Messages.STAFF_ROLE_NOT_ALLOWED,
    code: 'STAFF_ROLE_NOT_ALLOWED',
  }),
  UNAUTHORIZED: Object.freeze({
    statusCode: 401,
    message: Messages.UNAUTHENTICATED,
    code: 'UNAUTHORIZED',
  }),
  TOKEN_EXPIRED: Object.freeze({
    statusCode: 401,
    message: Messages.TOKEN_EXPIRED,
    code: 'TOKEN_EXPIRED',
  }),
  INVALID_TOKEN: Object.freeze({
    statusCode: 401,
    message: Messages.INVALID_TOKEN,
    code: 'INVALID_TOKEN',
  }),
});

module.exports = { AppErrors };
