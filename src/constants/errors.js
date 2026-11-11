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
  MEMBERSHIP_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.MEMBERSHIP_EXISTS,
    code: 'MEMBERSHIP_EXISTS',
  }),
  PLAN_DUPLICATE_NAME: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_DUPLICATE_NAME,
    code: 'PLAN_DUPLICATE_NAME',
  }),
  PLAN_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.PLAN_NOT_FOUND,
    code: 'PLAN_NOT_FOUND',
  }),
  PLAN_ARCHIVED: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_ARCHIVED,
    code: 'PLAN_ARCHIVED',
  }),
  PLAN_IN_USE: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_IN_USE,
    code: 'PLAN_IN_USE',
  }),
  PLAN_INVALID_TRANSITION: Object.freeze({
    statusCode: 409,
    message: Messages.PLAN_INVALID_TRANSITION,
    code: 'PLAN_INVALID_TRANSITION',
  }),
  METHOD_NOT_ALLOWED: Object.freeze({
    statusCode: 405,
    message: Messages.METHOD_NOT_ALLOWED,
    code: 'METHOD_NOT_ALLOWED',
  }),
  CLASS_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.CLASS_NOT_FOUND,
    code: 'CLASS_NOT_FOUND',
  }),
  CLASS_DUPLICATE_NAME: Object.freeze({
    statusCode: 409,
    message: Messages.CLASS_DUPLICATE_NAME,
    code: 'CLASS_DUPLICATE_NAME',
  }),
  CLASS_VERSION_CONFLICT: Object.freeze({
    statusCode: 409,
    message: Messages.CLASS_VERSION_CONFLICT,
    code: 'CLASS_VERSION_CONFLICT',
  }),
  CLASS_INACTIVE: Object.freeze({
    statusCode: 409,
    message: Messages.CLASS_INACTIVE,
    code: 'CLASS_INACTIVE',
  }),
  CLASS_HAS_FUTURE_BOOKINGS: Object.freeze({
    statusCode: 409,
    message: Messages.CLASS_HAS_FUTURE_BOOKINGS,
    code: 'CLASS_HAS_FUTURE_BOOKINGS',
  }),
  ROUTE_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.ROUTE_NOT_FOUND,
    code: 'ROUTE_NOT_FOUND',
  }),
  RESOURCE_ALREADY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.RESOURCE_ALREADY_EXISTS,
    code: 'RESOURCE_ALREADY_EXISTS',
  }),
  RESOURCE_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.RESOURCE_NOT_FOUND,
    code: 'RESOURCE_NOT_FOUND',
  }),
  PAYLOAD_TOO_LARGE: Object.freeze({
    statusCode: 413,
    message: Messages.PAYLOAD_TOO_LARGE,
    code: 'PAYLOAD_TOO_LARGE',
  }),
  RESOURCE_IN_USE: Object.freeze({
    statusCode: 409,
    message: Messages.RESOURCE_IN_USE,
    code: 'RESOURCE_IN_USE',
  }),
  SLOT_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.SLOT_NOT_FOUND,
    code: 'SLOT_NOT_FOUND',
  }),
  SESSION_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.SESSION_NOT_FOUND,
    code: 'SESSION_NOT_FOUND',
  }),
  SLOT_CONFLICT: Object.freeze({
    statusCode: 409,
    message: Messages.SLOT_CONFLICT,
    code: 'SLOT_CONFLICT',
  }),
  SESSION_CONFLICT: Object.freeze({
    statusCode: 409,
    message: Messages.SESSION_CONFLICT,
    code: 'SESSION_CONFLICT',
  }),
  COACH_CONFLICT: Object.freeze({
    statusCode: 409,
    message: Messages.COACH_CONFLICT,
    code: 'COACH_CONFLICT',
  }),
  UNAVAILABILITY_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.UNAVAILABILITY_NOT_FOUND,
    code: 'UNAVAILABILITY_NOT_FOUND',
  }),
  UNAVAILABILITY_OVERLAP: Object.freeze({
    statusCode: 409,
    message: Messages.UNAVAILABILITY_OVERLAP,
    code: 'UNAVAILABILITY_OVERLAP',
  }),
  UNAVAILABILITY_PAST_IMMUTABLE: Object.freeze({
    statusCode: 409,
    message: Messages.UNAVAILABILITY_PAST_IMMUTABLE,
    code: 'UNAVAILABILITY_PAST_IMMUTABLE',
  }),
  APPOINTMENT_TYPE_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.APPOINTMENT_TYPE_NOT_FOUND,
    code: 'APPOINTMENT_TYPE_NOT_FOUND',
  }),
  APPOINTMENT_TYPE_NAME_TAKEN: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_TYPE_NAME_TAKEN,
    code: 'APPOINTMENT_TYPE_NAME_TAKEN',
  }),
  APPOINTMENT_TYPE_INACTIVE: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_TYPE_INACTIVE,
    code: 'APPOINTMENT_TYPE_INACTIVE',
  }),
  APPOINTMENT_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.APPOINTMENT_NOT_FOUND,
    code: 'APPOINTMENT_NOT_FOUND',
  }),
  APPOINTMENT_ALREADY_CANCELLED: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_ALREADY_CANCELLED,
    code: 'APPOINTMENT_ALREADY_CANCELLED',
  }),
  APPOINTMENT_PAST_IMMUTABLE: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_PAST_IMMUTABLE,
    code: 'APPOINTMENT_PAST_IMMUTABLE',
  }),
  MEMBER_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.APPOINTMENT_MEMBER_NOT_FOUND,
    code: 'MEMBER_NOT_FOUND',
  }),
  MEMBER_NOT_ACTIVE: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_MEMBER_NOT_ACTIVE,
    code: 'MEMBER_NOT_ACTIVE',
  }),
  COACH_INACTIVE: Object.freeze({
    statusCode: 409,
    message: Messages.APPOINTMENT_COACH_INACTIVE,
    code: 'COACH_INACTIVE',
  }),
  NOTIFICATION_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.NOTIFICATION_NOT_FOUND,
    code: 'NOTIFICATION_NOT_FOUND',
  }),
  SESSION_VERSION_CONFLICT: Object.freeze({
    statusCode: 409,
    message: Messages.SESSION_VERSION_CONFLICT,
    code: 'SESSION_VERSION_CONFLICT',
  }),
  SESSION_PAST_IMMUTABLE: Object.freeze({
    statusCode: 409,
    message: Messages.SESSION_PAST_IMMUTABLE,
    code: 'SESSION_PAST_IMMUTABLE',
  }),
  SESSION_NOT_CANCELLED: Object.freeze({
    statusCode: 409,
    message: Messages.SESSION_NOT_CANCELLED,
    code: 'SESSION_NOT_CANCELLED',
  }),
  CAPACITY_BELOW_BOOKED: Object.freeze({
    statusCode: 400,
    message: Messages.CAPACITY_BELOW_BOOKED,
    code: 'CAPACITY_BELOW_BOOKED',
  }),
  CANCEL_REASON_REQUIRED: Object.freeze({
    statusCode: 400,
    message: Messages.CANCEL_REASON_REQUIRED,
    code: 'CANCEL_REASON_REQUIRED',
  }),

  // Cafe Catalogue (Tickets 79 & 80)
  CATEGORY_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.CATEGORY_NOT_FOUND,
    code: 'CATEGORY_NOT_FOUND',
  }),
  CATEGORY_NOT_FOUND_BODY: Object.freeze({
    statusCode: 400,
    message: Messages.CATEGORY_NOT_FOUND,
    code: 'CATEGORY_NOT_FOUND',
  }),
  CATEGORY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.CATEGORY_EXISTS,
    code: 'CATEGORY_EXISTS',
  }),
  CATEGORY_HAS_ITEMS: Object.freeze({
    statusCode: 409,
    message: Messages.CATEGORY_HAS_ITEMS,
    code: 'CATEGORY_HAS_ITEMS',
  }),
  ITEM_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.ITEM_NOT_FOUND,
    code: 'ITEM_NOT_FOUND',
  }),
  ITEM_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.ITEM_EXISTS,
    code: 'ITEM_EXISTS',
  }),
  ORDER_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.ORDER_NOT_FOUND,
    code: 'ORDER_NOT_FOUND',
  }),
  INVALID_ORDER_STATUS_TRANSITION: Object.freeze({
    statusCode: 409,
    message: Messages.ORDER_STATUS_TRANSITION_INVALID,
    code: 'INVALID_ORDER_STATUS_TRANSITION',
  }),
  ITEM_NOT_TRACKED: Object.freeze({
    statusCode: 409,
    message: Messages.ITEM_NOT_TRACKED,
    code: 'ITEM_NOT_TRACKED',
  }),
  ITEM_INSUFFICIENT_STOCK: Object.freeze({
    statusCode: 409,
    message: Messages.ITEM_INSUFFICIENT_STOCK,
    code: 'ITEM_INSUFFICIENT_STOCK',
  }),
  ITEM_SOLD_OUT_ZERO_STOCK: Object.freeze({
    statusCode: 400,
    message: Messages.ITEM_SOLD_OUT_ZERO_STOCK,
    code: 'ITEM_SOLD_OUT_ZERO_STOCK',
  }),
  ITEM_TRACKED_STOCK_REQUIRED: Object.freeze({
    statusCode: 400,
    message: Messages.ITEM_TRACKED_STOCK_REQUIRED,
    code: 'ITEM_TRACKED_STOCK_REQUIRED',
  }),
  IMAGE_TYPE_NOT_ALLOWED: Object.freeze({
    statusCode: 400,
    message: Messages.IMAGE_TYPE_NOT_ALLOWED,
    code: 'IMAGE_TYPE_NOT_ALLOWED',
  }),
  IMAGE_UPLOAD_NOT_CONFIGURED: Object.freeze({
    statusCode: 503,
    message: Messages.IMAGE_UPLOAD_NOT_CONFIGURED,
    code: 'IMAGE_UPLOAD_NOT_CONFIGURED',
  }),
  IMAGE_UPLOAD_TOKEN_FAILED: Object.freeze({
    statusCode: 502,
    message: Messages.IMAGE_UPLOAD_TOKEN_FAILED,
    code: 'IMAGE_UPLOAD_TOKEN_FAILED',
  }),
  // Booking rules (SLAPP-104). The enforcement codes are for the booking, pause and credit APIs.
  BOOKING_RULE_NOT_FOUND: Object.freeze({
    statusCode: 404,
    message: Messages.BOOKING_RULE_NOT_FOUND,
    code: 'BOOKING_RULE_NOT_FOUND',
  }),
  BOOKING_RULE_ALREADY_EXISTS: Object.freeze({
    statusCode: 409,
    message: Messages.BOOKING_RULE_ALREADY_EXISTS,
    code: 'BOOKING_RULE_ALREADY_EXISTS',
  }),
  BOOKING_WINDOW_NOT_OPEN: Object.freeze({
    statusCode: 409,
    message: Messages.BOOKING_WINDOW_NOT_OPEN,
    code: 'BOOKING_WINDOW_NOT_OPEN',
  }),
  BOOKING_WINDOW_CLOSED: Object.freeze({
    statusCode: 409,
    message: Messages.BOOKING_WINDOW_CLOSED,
    code: 'BOOKING_WINDOW_CLOSED',
  }),
  WAITLIST_FULL: Object.freeze({
    statusCode: 409,
    message: Messages.WAITLIST_FULL,
    code: 'WAITLIST_FULL',
  }),
  GUEST_LIMIT_EXCEEDED: Object.freeze({
    statusCode: 409,
    message: Messages.GUEST_LIMIT_EXCEEDED,
    code: 'GUEST_LIMIT_EXCEEDED',
  }),
  BOOKING_LIMIT_REACHED: Object.freeze({
    statusCode: 409,
    message: Messages.BOOKING_LIMIT_REACHED,
    code: 'BOOKING_LIMIT_REACHED',
  }),
  BOOKING_SUSPENDED: Object.freeze({
    statusCode: 409,
    message: Messages.BOOKING_SUSPENDED,
    code: 'BOOKING_SUSPENDED',
  }),
  CLIENT_PAUSE_NOT_ALLOWED: Object.freeze({
    statusCode: 403,
    message: Messages.CLIENT_PAUSE_NOT_ALLOWED,
    code: 'CLIENT_PAUSE_NOT_ALLOWED',
  }),
  CREDIT_OVERDRAFT_NOT_ALLOWED: Object.freeze({
    statusCode: 409,
    message: Messages.CREDIT_OVERDRAFT_NOT_ALLOWED,
    code: 'CREDIT_OVERDRAFT_NOT_ALLOWED',
  }),
  CLASSPASS_NOT_ACCEPTED: Object.freeze({
    statusCode: 409,
    message: Messages.CLASSPASS_NOT_ACCEPTED,
    code: 'CLASSPASS_NOT_ACCEPTED',
  }),
});

module.exports = { AppErrors };
