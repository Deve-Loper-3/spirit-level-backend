// Pattern: Chain of Responsibility — sync guards ({ otp, now, maxAttempts, resetTokenHash }) that throw createAppError(AppErrors.X) or return.
// Run a chain with runGuards (auth.guards). The async bcrypt OTP comparison is NOT a guard: the service does it after the chain.
// `otp` is the latest PasswordResetOtp row of the user (null when there is none, e.g. unknown email).
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

// Unknown email and "no OTP yet" give the same error as a wrong OTP, so the email is not revealed.
const ensureOtpExists = ({ otp }) => {
  if (!otp) {
    throw createAppError(AppErrors.OTP_INVALID);
  }
};

const ensureNotUsed = ({ otp }) => {
  if (otp.usedAt) {
    throw createAppError(AppErrors.OTP_ALREADY_USED);
  }
};

// An OTP can be verified only once, otherwise every verify call would mint a new reset token.
const ensureNotVerified = ({ otp }) => {
  if (otp.verifiedAt) {
    throw createAppError(AppErrors.OTP_ALREADY_USED);
  }
};

// Before the invalidated check: an OTP closed because of too many attempts should say so.
const ensureAttemptsLeft = ({ otp, maxAttempts }) => {
  if (otp.attempts >= maxAttempts) {
    throw createAppError(AppErrors.OTP_ATTEMPTS_EXCEEDED);
  }
};

// Invalidated = replaced by a newer OTP, so it looks like any other wrong OTP.
const ensureNotInvalidated = ({ otp }) => {
  if (otp.invalidatedAt) {
    throw createAppError(AppErrors.OTP_INVALID);
  }
};

const ensureNotExpired = ({ otp, now }) => {
  if (otp.expiresAt <= now) {
    throw createAppError(AppErrors.OTP_EXPIRED);
  }
};

const ensureVerified = ({ otp }) => {
  if (!otp.verifiedAt) {
    throw createAppError(AppErrors.OTP_INVALID);
  }
};

// Both values are SHA-256 hashes of the token, never the raw token.
const ensureResetTokenMatches = ({ otp, resetTokenHash }) => {
  if (otp.resetTokenHash !== resetTokenHash) {
    throw createAppError(AppErrors.OTP_INVALID);
  }
};

const verifyOtpGuards = [
  ensureOtpExists,
  ensureNotUsed,
  ensureNotVerified,
  ensureAttemptsLeft,
  ensureNotInvalidated,
  ensureNotExpired,
];

const resetPasswordGuards = [
  ensureOtpExists,
  ensureNotUsed,
  ensureVerified,
  ensureNotInvalidated,
  ensureNotExpired,
  ensureResetTokenMatches,
];

module.exports = {
  ensureOtpExists,
  ensureNotUsed,
  ensureNotVerified,
  ensureAttemptsLeft,
  ensureNotInvalidated,
  ensureNotExpired,
  ensureVerified,
  ensureResetTokenMatches,
  verifyOtpGuards,
  resetPasswordGuards,
};
