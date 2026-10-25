const { Messages } = require('./messages');

const AppErrors = Object.freeze({
  USER_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.USER_NOT_FOUND,
    code: 'USER_NOT_FOUND',
  }),
  COACH_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.COACH_NOT_FOUND,
    code: 'COACH_NOT_FOUND',
  }),
  COACH_EMAIL_ALREADY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.COACH_EMAIL_ALREADY_EXISTS,
    code: 'COACH_EMAIL_ALREADY_EXISTS',
  }),
  VALIDATION_ERROR: Object.freeze({
    statusCode: 400,
    message: Messages.VALIDATION_FAILED,
    code: 'VALIDATION_ERROR',
  }),
  INTERNAL_SERVER_ERROR: Object.freeze({
    statusCode: 500,
    message: Messages.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
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
  OTP_INVALID: Object.freeze({
    statusCode: 400,
    message: Messages.OTP_INVALID,
    code: 'OTP_INVALID',
  }),
  OTP_EXPIRED: Object.freeze({
    statusCode: 400,
    message: Messages.OTP_EXPIRED,
    code: 'OTP_EXPIRED',
  }),
  OTP_ALREADY_USED: Object.freeze({
    statusCode: 400,
    message: Messages.OTP_ALREADY_USED,
    code: 'OTP_ALREADY_USED',
  }),
  OTP_ATTEMPTS_EXCEEDED: Object.freeze({
    statusCode: 429,
    message: Messages.OTP_ATTEMPTS_EXCEEDED,
    code: 'OTP_ATTEMPTS_EXCEEDED',
  }),
  PLAN_DUPLICATE_NAME: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_DUPLICATE_NAME,
    code: 'duplicate_name',
  }),
  PLAN_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.PLAN_NOT_FOUND,
    code: 'PLAN_NOT_FOUND',
  }),
  PLAN_ARCHIVED: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_ARCHIVED,
    code: 'plan_archived',
  }),
  PLAN_IN_USE: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_IN_USE,
    code: 'plan_in_use',
  }),
  PLAN_INVALID_TRANSITION: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_INVALID_TRANSITION,
    code: 'invalid_transition',
  }),
  METHOD_NOT_ALLOWED: Object.freeze({
    statusCode: 405,
    message: Messages.METHOD_NOT_ALLOWED,
    code: 'METHOD_NOT_ALLOWED',
  }),
});

module.exports = { AppErrors };
