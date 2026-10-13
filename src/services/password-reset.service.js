const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../config/logger');
const { AuditAction, PasswordResetSkipReason } = require('../constants/audit');
const { AppErrors } = require('../constants/errors');
const { AccountStatus } = require('../constants/status');
const { Messages } = require('../constants/messages');
const { createAppError } = require('../errors/AppError');
const { hashPassword, comparePassword } = require('../utils/password.util');
const { generateOtp } = require('../utils/otp.util');
const { generateRefreshToken, hashToken } = require('../utils/token.util');
const { findByEmail } = require('../repositories/user.repository');
const { createAuditLog } = require('../repositories/audit-log.repository');
const {
  createOtpTx,
  findLatestByEmail,
  incrementAttempts,
  invalidateOtp,
  markVerifiedTx,
  resetPasswordTx,
} = require('../repositories/password-reset.repository');
const { runGuards } = require('./auth.guards');
const { verifyOtpGuards, resetPasswordGuards } = require('./otp.guards');
const { sendPasswordResetOtp } = require('../infra/mail/notify.service');

// null = the user may reset the password. Anything but ACTIVE is denied (deny by default).
const getSkipReason = (user) => {
  if (!user) return PasswordResetSkipReason.UNKNOWN_EMAIL;
  if (user.status === AccountStatus.ACTIVE) return null;
  return user.status === AccountStatus.PENDING
    ? PasswordResetSkipReason.ACCOUNT_PENDING
    : PasswordResetSkipReason.ACCOUNT_DISABLED;
};

// Not awaited by the caller: the response must not wait for (or reveal) the mail server.
// A failed send is logged without the OTP, the email address or the error message.
const sendOtpInBackground = (user, otp) => {
  sendPasswordResetOtp({ email: user.email, fullName: user.fullName }, otp).catch((err) => {
    logger.error(
      { userId: user.id, errorName: err.name, errorCode: err.code },
      Messages.PASSWORD_RESET_EMAIL_FAILED,
    );
  });
};

// Resolves the same way for known and unknown emails. meta: { ipAddress, userAgent }.
const requestPasswordReset = async ({ email, meta }) => {
  const user = await findByEmail(email);

  const skipReason = getSkipReason(user);
  if (skipReason) {
    await createAuditLog(prisma, {
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      reason: skipReason,
      email,
      meta,
    });
    return;
  }

  const otp = generateOtp();
  const otpHash = await hashPassword(otp);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

  await createOtpTx({ userId: user.id, email: user.email, otpHash, expiresAt, now, meta });

  sendOtpInBackground(user, otp);
};

// Wrong OTP: count the attempt, close the OTP when the limit is reached, audit (never the OTP).
const failWrongOtp = async (row, meta) => {
  const { attempts } = await incrementAttempts(row.id);
  const attemptsExceeded = attempts >= env.OTP_MAX_ATTEMPTS;
  const error = attemptsExceeded ? AppErrors.OTP_ATTEMPTS_EXCEEDED : AppErrors.OTP_INVALID;

  if (attemptsExceeded) {
    await invalidateOtp(row.id, new Date());
  }
  await createAuditLog(prisma, {
    userId: row.user.id,
    action: AuditAction.PASSWORD_RESET_OTP_FAILED,
    reason: error.code,
    email: row.user.email,
    meta,
  });

  throw createAppError(error);
};

// null for a missing or non-ACTIVE user: the guards then throw the same OTP_INVALID as for a
// wrong OTP (enumeration safe).
const findLatestOtpOfActiveUser = async (email) => {
  const row = await findLatestByEmail(email);
  return row?.user.status === AccountStatus.ACTIVE ? row : null;
};

// Returns the one-time reset token for step 3; only its hash is stored.
const verifyResetOtp = async ({ email, otp, meta }) => {
  const otpRow = await findLatestOtpOfActiveUser(email);

  runGuards(verifyOtpGuards, {
    otp: otpRow,
    now: new Date(),
    maxAttempts: env.OTP_MAX_ATTEMPTS,
  });

  if (!(await comparePassword(otp, otpRow.otpHash))) {
    return failWrongOtp(otpRow, meta);
  }

  const resetToken = generateRefreshToken();
  await markVerifiedTx({
    otpId: otpRow.id,
    userId: otpRow.user.id,
    email: otpRow.user.email,
    resetTokenHash: hashToken(resetToken),
    now: new Date(),
    meta,
  });

  return { resetToken, expiresAt: otpRow.expiresAt };
};

const resetPassword = async ({ email, resetToken, newPassword, meta }) => {
  const otpRow = await findLatestOtpOfActiveUser(email);

  runGuards(resetPasswordGuards, {
    otp: otpRow,
    now: new Date(),
    resetTokenHash: hashToken(resetToken),
  });

  await resetPasswordTx({
    otpId: otpRow.id,
    userId: otpRow.user.id,
    email: otpRow.user.email,
    passwordHash: await hashPassword(newPassword),
    now: new Date(),
    meta,
  });
};

module.exports = { requestPasswordReset, verifyResetOtp, resetPassword };
