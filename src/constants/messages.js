const Messages = Object.freeze({
  // Generic
  SUCCESS: 'Success',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  VALIDATION_FAILED: 'Validation failed',
  ROUTE_NOT_FOUND: 'The requested route does not exist',
  TOO_MANY_REQUESTS: 'Too many requests, please try again later',

  // Auth
  REGISTER_SUCCESS: 'Registration successful',
  REGISTRATION_COMPLETE_SUCCESS: 'Registration completed successfully',
  LOGIN_SUCCESS: 'Login successful',
  TOKEN_REFRESH_SUCCESS: 'Token refreshed successfully',
  PROFILE_FETCHED_SUCCESS: 'Profile fetched successfully',
  AUTHORIZATION_DENIED: 'Authorization denied: role not allowed for this endpoint',
  LOGOUT_SUCCESS: 'Logout successful',
  LOGIN_AUDIT_WRITE_FAILED: 'Failed to write login audit log',
  INVALID_CREDENTIALS: 'Invalid email or password',
  PASSWORD_MISMATCH: 'Password and confirm password do not match',

  // Password reset
  PASSWORD_RESET_OTP_REQUESTED: 'If the email is registered, an OTP has been sent to it',
  PASSWORD_RESET_OTP_VERIFIED_SUCCESS: 'OTP verified successfully',
  PASSWORD_RESET_SUCCESS: 'Password has been reset successfully',
  OTP_INVALID: 'Invalid OTP',
  OTP_EXPIRED: 'OTP has expired, please request a new one',
  OTP_ALREADY_USED: 'OTP has already been used, please request a new one',
  OTP_ATTEMPTS_EXCEEDED: 'Too many incorrect attempts, please request a new OTP',
  PASSWORD_RESET_EMAIL_FAILED: 'Failed to send password reset OTP email',
  OTP_REQUIRED: 'OTP is required',
  OTP_FORMAT_INVALID: 'OTP must be exactly 4 digits',
  RESET_TOKEN_REQUIRED: 'Reset token is required',
  REFRESH_TOKEN_REQUIRED: 'Refresh token is required',

  // Credential field validation
  EMAIL_REQUIRED: 'Email is required',
  EMAIL_MAX_LENGTH: 'Email must be at most 254 characters',
  EMAIL_INVALID: 'Must be a valid email address',
  PASSWORD_REQUIRED: 'Password is required',
  PASSWORD_MAX_LENGTH: 'Password must be at most 72 characters',

  // Registration field validation
  FULL_NAME_REQUIRED: 'Full name is required',
  FULL_NAME_MIN_LENGTH: 'Full name must be at least 2 characters',
  FULL_NAME_MAX_LENGTH: 'Full name must be at most 100 characters',
  PHONE_REQUIRED: 'Phone number is required',
  PHONE_INVALID: 'Must be a valid international number (e.g. +12025551234)',
  WHATSAPP_INVALID: 'WhatsApp number is invalid',
  GENDER_INVALID: 'Gender must be one of: MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY',
  MUST_BE_INTEGER: 'Must be an integer',
  BIRTH_DAY_RANGE: 'Birth day must be between 1 and 31',
  BIRTH_MONTH_RANGE: 'Birth month must be between 1 and 12',
  BIRTH_MONTH_REQUIRED_WITH_DAY: 'birthMonth is required when birthDay is provided',
  BIRTH_DAY_REQUIRED_WITH_MONTH: 'birthDay is required when birthMonth is provided',
  BIRTH_DAY_INVALID_FOR_MONTH: (day, month, maxDay) =>
    `Day ${day} is not valid for month ${month} (max ${maxDay})`,

  // Uniqueness conflicts
  USER_ALREADY_EXISTS: 'User already exists',
  PHONE_ALREADY_EXISTS: 'Phone number already registered',

  // Registration Step 2
  REGISTRATION_ALREADY_COMPLETED: 'Registration has already been completed',
  ACCOUNT_NOT_ELIGIBLE: 'Account is not eligible to complete registration',

  // Emergency contact & waiver validation
  REGISTRATION_ID_REQUIRED: 'Registration ID is required',
  REGISTRATION_ID_INVALID: 'Registration ID must be a valid UUID',
  EMERGENCY_CONTACT_REQUIRED: 'Emergency contact is required',
  EMERGENCY_NAME_MIN_LENGTH: 'Emergency contact name must be at least 2 characters',
  EMERGENCY_NAME_MAX_LENGTH: 'Emergency contact name must be at most 100 characters',
  EMERGENCY_PHONE_REQUIRED: 'Emergency contact phone number is required',
  EMERGENCY_PHONE_INVALID: 'Emergency contact phone number must be a valid international number',
  EMERGENCY_PHONE_SAME_AS_MEMBER:
    'Emergency contact phone number must be different from member phone number',
  EMERGENCY_RELATIONSHIP_INVALID:
    'Relationship must be one of: PARENT, SPOUSE, SIBLING, CHILD, FRIEND, GUARDIAN, OTHER',
  WAIVER_MUST_BE_ACCEPTED: 'Waiver must be accepted to complete registration',

  // Tokens
  NO_TOKEN_PROVIDED: 'Authentication token was not provided',
  INVALID_TOKEN: 'Invalid or malformed authentication token',
  TOKEN_EXPIRED: 'Authentication token has expired',

  // Authorization
  UNAUTHENTICATED: 'Authentication is required to access this resource',
  FORBIDDEN: 'You do not have permission to perform this action',

  // Account status
  ACCOUNT_DISABLED: 'This account has been disabled. Please contact an administrator.',
  REGISTRATION_INCOMPLETE: 'Please complete your registration before logging in.',

  // Resources
  USER_NOT_FOUND: 'User not found',

  // Coach
  COACH_NOT_FOUND: 'Coach not found',
  COACH_EMAIL_ALREADY_EXISTS: 'A coach with this email already exists',
  COACH_CREATED_SUCCESS: 'Coach created successfully',
  COACH_UPDATED_SUCCESS: 'Coach updated successfully',
  COACH_STATUS_UPDATED_SUCCESS: 'Coach status updated successfully',
  COACH_UPDATE_EMPTY: 'Provide at least one field to update',
  COACH_TYPE_INVALID: 'Coach type must be one of: SALARIED, FREELANCE',
  COACH_STATUS_INVALID: 'Coach status must be one of: ACTIVE, INACTIVE',
  COACH_BIO_INVALID: 'Bio must be a string',
  COACH_BIO_MAX_LENGTH: 'Bio must be at most 1000 characters',
  COACH_ID_INVALID: 'Coach id must be a valid UUID',
  COACH_SEARCH_INVALID: 'Search must be text of at most 100 characters',
  PAGE_INVALID: 'Page must be a whole number between 1 and 100000',
  LIMIT_INVALID: 'Limit must be a whole number between 1 and 100',

  // Staff
  STAFF_CREATED_SUCCESS: 'Staff account created successfully',
  STAFF_ROLE_NOT_ALLOWED: 'You are not allowed to create a staff account with this role',
  STAFF_ROLE_INVALID: 'Role must be one of: MEMBER, ADMIN, OWNER',
  STAFF_COACH_USE_COACH_ENDPOINT: 'Coaches are created with POST /api/v1/admin/staff/coaches',
  STAFF_CREATE_DENIED_REASON: (actorRole, targetRole) =>
    `${actorRole || 'UNKNOWN'} attempted to create ${targetRole}`,
  STAFF_INVITATION_EMAIL_FAILED: 'Failed to send staff invitation email',

  // Image upload
  IMAGE_TYPE_NOT_ALLOWED: 'Image must be a JPEG, PNG or WebP file',
  IMAGE_URL_INVALID: 'Profile image URL is not valid',
  PROFILE_IMAGE_UPDATED_SUCCESS: 'Profile image updated successfully',
  IMAGE_UPLOAD_TOKEN_ISSUED: 'Image upload token issued successfully',
  IMAGE_UPLOAD_TOKEN_FAILED: 'Failed to prepare the image upload, please try again later',
  IMAGE_UPLOAD_NOT_CONFIGURED: 'Image upload is not available right now',
  IMAGE_DELETE_FAILED: 'Failed to delete image from storage',

  // Membership plans
  PLAN_CREATED_SUCCESS: 'Membership plan created successfully',
  PLAN_DUPLICATE_NAME: 'A membership plan with this name already exists',
  PLAN_RENEW_SUBSCRIPTION_ONLY: 'Only a membership renews monthly.',
  PLAN_PRICE_REQUIRED: 'Price is required and must be at least 0',
  PLAN_CREDITS_REQUIRED_NON_TIME: 'creditsIncluded must be at least 1 when creditType is not TIME',
  PLAN_CREDITS_TIME_ZERO: 'creditsIncluded must be 0 or omitted for time-based plans',
  PAGE_SIZE_INVALID: 'Page size must be a whole number between 1 and 100',
  PLAN_SORT_INVALID: 'Sort must be one of: name, price, createdAt (prefix with - for descending)',
  PLAN_SECTION_INVALID: 'Section must be one of: class_membership, online_coaching',
  PLAN_KIND_INVALID: 'Kind must be one of: subscription, credit_pack, single_visit, trial',
  PLAN_CREDIT_TYPE_INVALID: 'Credit type must be one of: class, appointment, facility, time',
  PLAN_VISIBILITY_INVALID: 'Visibility must be one of: public, hidden',
  PLAN_STATUS_INVALID: 'Status must be a comma-separated list of: active, inactive, archived',
  PLAN_SEARCH_INVALID: 'Search must be text of at most 100 characters',
  PLAN_UPDATED_SUCCESS: 'Membership plan updated successfully',
  PLAN_STATUS_UPDATED_SUCCESS: 'Membership plan status updated successfully',
  PLAN_NOT_FOUND: 'Membership plan not found',
  PLAN_ARCHIVED: 'An archived membership plan cannot be edited',
  PLAN_IN_USE:
    'Time-based and credit-based plans cannot be switched while clients are using the plan',
  PLAN_INVALID_TRANSITION: 'This status change is not allowed',
  PLAN_UPDATE_EMPTY: 'Provide at least one field to update',
  PLAN_FIELD_NOT_EDITABLE: 'This field cannot be edited',
  PLAN_STATUS_USE_STATUS_ENDPOINT:
    'Status cannot be edited here, use PATCH /api/v1/plans/:id/status',
  PLAN_FIELD_UNKNOWN: 'Unknown field',
  PLAN_STATUS_VALUE_INVALID: 'Status must be one of: active, inactive, archived',
  PLAN_STATUS_REASON_INVALID: 'Reason must be text of at most 200 characters',
  METHOD_NOT_ALLOWED: 'Method not allowed for this route',
  PLAN_REFILL_MONTHLY_RESTRICTION: 'creditRefill can only be MONTHLY when billingCycle is MONTH',

  // Classes
  CLASS_NOT_FOUND: 'Class not found',
  CLASS_DUPLICATE_NAME: 'A class with this name already exists',
  CLASS_VERSION_CONFLICT:
    'The class has been updated by another user. Please reload and try again.',
  CLASS_INACTIVE: 'An inactive class cannot be edited',
  CLASS_HAS_FUTURE_BOOKINGS: 'Class has future sessions with bookings and cannot be deactivated',
  RESOURCE_IN_USE:
    'Cannot delete or modify record because it is currently referenced by other resources',
  CLASS_CREATED_SUCCESS: 'Class created successfully',
  CLASS_UPDATED_SUCCESS: 'Class updated successfully',
  CLASS_DEACTIVATED_SUCCESS: 'Class deactivated successfully',
  CLASS_ACTIVATED_SUCCESS: 'Class activated successfully',
  CLASS_ARCHIVED_SUCCESS: 'Class archived successfully',
  CLASS_ELIGIBILITY_UPDATED_SUCCESS: 'Class eligibility updated successfully',
  CLASS_NAME_REQUIRED: 'Class name is required',
  CLASS_NAME_INVALID: 'Class name must be between 2 and 80 characters',
  CLASS_DESCRIPTION_MAX: 'Description must be at most 1000 characters',
  CLASS_DURATION_INVALID: 'Duration must be an integer between 15 and 240 minutes',
  CLASS_BASE_CAPACITY_INVALID: 'Base capacity must be an integer between 1 and 200',
  CLASS_INTENSITY_INVALID: 'Intensity must be an integer between 1 and 5',
  CLASS_VISIBILITY_INVALID: 'Visibility must be one of: public, private',
  CLASS_TYPE_INVALID: 'Class type must be one of: onsite, online',
  CLASS_CLASSPASS_ENABLED_REQUIRED: 'classPassEnabled must be a boolean',
  CLASS_CLASSPASS_DISABLED_SPOTS_MUST_BE_ZERO:
    'ClassPass spots must be 0 when ClassPass is disabled',
  CLASS_CLASSPASS_SPOTS_INVALID: 'Classpass spots must be an integer between 0 and base capacity',
  CLASS_COLOUR_INVALID: 'Colour must be a valid hex code in the format #RRGGBB',
  CLASS_PHOTO_URL_INVALID: 'Photo URL must be a valid HTTPS URL up to 2048 characters',
  CLASS_PUBLIC_REQUIRES_PLANS: 'A public class must have at least one eligible membership plan',
  CLASS_PLAN_NOT_FOUND: 'One or more plan IDs do not exist',
  CLASS_PLAN_ARCHIVED: 'Archived plans cannot be assigned to a class',
  CLASS_COACH_NOT_FOUND: 'One or more coach IDs do not exist or are not active',
  CLASS_STATUS_INVALID: 'Status must be one of: active, deactivated, archived, all',
  CLASS_FIELD_NOT_EDITABLE: 'This field cannot be edited',
  CLASS_ELIGIBILITY_USE_ENDPOINT:
    'Eligible plans cannot be edited here, use PUT /api/v1/classes/:id/eligibility',
  CLASS_DEACTIVATE_USE_ENDPOINT:
    'Active status cannot be edited here, use POST /api/v1/classes/:id/deactivate',
  CLASS_UPDATE_EMPTY: 'Provide at least one field to update',
});

module.exports = { Messages };
