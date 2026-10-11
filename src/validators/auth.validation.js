const z = require('zod');
const { Gender } = require('../constants/gender');
const { Relationship } = require('../constants/relationship');
const { Messages } = require('../constants/messages');
const { PASSWORD_REGEX, PASSWORD_POLICY_MESSAGE } = require('../utils/password.util');
const { OTP_LENGTH } = require('../utils/otp.util');
const { trustedImageUrl } = require('./uploads.validation');

// Max valid day per month (no year stored; Feb 29 is allowed)
const MAX_DAYS_PER_MONTH = {
  1: 31,
  2: 29,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};

const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

// "" or null treated as absent; numeric string coerced to number
const toOptionalInt = (v) => {
  if (v === '' || v === null) return undefined;
  if (v !== undefined && typeof v === 'string') return Number(v);
  return v;
};

// "" or null treated as absent for optional string fields
const toOptionalString = (v) => (v === '' || v === null ? undefined : v);

// Missing, null, or empty/whitespace string treated as absent
const toOptionalTrimmedString = (v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return v;
};

// Strip spaces, dashes, parentheses then validate E.164-style format
const phoneField = (requiredMsg, invalidMsg = Messages.PHONE_INVALID) =>
  z
    .string({ error: requiredMsg })
    .overwrite((v) => v.replace(/[\s\-()]/g, ''))
    .regex(PHONE_REGEX, invalidMsg);

const optionalIntField = (min, max, rangeMsg) =>
  z.preprocess(
    toOptionalInt,
    z.int({ error: Messages.MUST_BE_INTEGER }).min(min, rangeMsg).max(max, rangeMsg).optional(),
  );

// Shared by register and login so both normalize email the same way
const emailField = z
  .string({ error: Messages.EMAIL_REQUIRED })
  .trim()
  .toLowerCase()
  .max(254, Messages.EMAIL_MAX_LENGTH)
  .email(Messages.EMAIL_INVALID);

// Shared by register and reset-password so the password policy lives in one place
const passwordField = z
  .string({ error: Messages.PASSWORD_REQUIRED })
  .max(72, Messages.PASSWORD_MAX_LENGTH)
  .regex(PASSWORD_REGEX, PASSWORD_POLICY_MESSAGE);

const fullNameField = z
  .string({ error: Messages.FULL_NAME_REQUIRED })
  .trim()
  .min(2, Messages.FULL_NAME_MIN_LENGTH)
  .max(100, Messages.FULL_NAME_MAX_LENGTH);

const registerSchema = z
  .object({
    fullName: fullNameField,

    email: emailField,

    phone: phoneField(Messages.PHONE_REQUIRED),

    whatsappNumber: z.preprocess(
      toOptionalString,
      phoneField(Messages.WHATSAPP_INVALID).optional(),
    ),

    gender: z.enum(Object.values(Gender), {
      error: Messages.GENDER_INVALID,
    }),

    birthDay: optionalIntField(1, 31, Messages.BIRTH_DAY_RANGE),

    birthMonth: optionalIntField(1, 12, Messages.BIRTH_MONTH_RANGE),

    profileImageUrl: z.preprocess(toOptionalTrimmedString, trustedImageUrl.optional()),

    password: passwordField,
  })
  .check((ctx) => {
    const { birthDay, birthMonth } = ctx.value;
    const hasDay = birthDay !== undefined;
    const hasMonth = birthMonth !== undefined;

    if (hasDay && !hasMonth) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: Messages.BIRTH_MONTH_REQUIRED_WITH_DAY,
        path: ['birthMonth'],
      });
      return;
    }

    if (hasMonth && !hasDay) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: Messages.BIRTH_DAY_REQUIRED_WITH_MONTH,
        path: ['birthDay'],
      });
      return;
    }

    if (hasDay && hasMonth && birthDay > MAX_DAYS_PER_MONTH[birthMonth]) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: Messages.BIRTH_DAY_INVALID_FOR_MONTH(
          birthDay,
          birthMonth,
          MAX_DAYS_PER_MONTH[birthMonth],
        ),
        path: ['birthDay'],
      });
    }
  });

const completeRegistrationSchema = z.object({
  registrationId: z
    .string({ error: Messages.REGISTRATION_ID_REQUIRED })
    .uuid(Messages.REGISTRATION_ID_INVALID),

  emergencyContact: z.object(
    {
      name: z.preprocess(
        toOptionalTrimmedString,
        z
          .string()
          .trim()
          .min(2, Messages.EMERGENCY_NAME_MIN_LENGTH)
          .max(100, Messages.EMERGENCY_NAME_MAX_LENGTH)
          .optional(),
      ),

      phone: phoneField(Messages.EMERGENCY_PHONE_REQUIRED, Messages.EMERGENCY_PHONE_INVALID),

      relationship: z.preprocess(
        toOptionalTrimmedString,
        z
          .enum(Object.values(Relationship), {
            error: Messages.EMERGENCY_RELATIONSHIP_INVALID,
          })
          .optional(),
      ),
    },
    { error: Messages.EMERGENCY_CONTACT_REQUIRED },
  ),

  waiverAccepted: z.literal(true, {
    error: Messages.WAIVER_MUST_BE_ACCEPTED,
  }),
});

// No policy regex on login: older passwords must still work and rules must not leak
const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ error: Messages.PASSWORD_REQUIRED })
    .min(1, Messages.PASSWORD_REQUIRED)
    .max(72, Messages.PASSWORD_MAX_LENGTH),
});

const forgotPasswordSchema = z.object({
  email: emailField,
});

const verifyOtpSchema = z.object({
  email: emailField,
  otp: z
    .string({ error: Messages.OTP_REQUIRED })
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), Messages.OTP_FORMAT_INVALID),
});

const resetPasswordSchema = z.object({
  email: emailField,
  resetToken: z
    .string({ error: Messages.RESET_TOKEN_REQUIRED })
    .trim()
    .min(1, Messages.RESET_TOKEN_REQUIRED),
  newPassword: passwordField,
});

const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ error: Messages.REFRESH_TOKEN_REQUIRED })
    .trim()
    .min(1, Messages.REFRESH_TOKEN_REQUIRED),
});

module.exports = {
  registerSchema,
  completeRegistrationSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  fullNameField,
  emailField,
  phoneField,
};
