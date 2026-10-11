const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AuditAction } = require('../constants/audit');
const { AppErrors } = require('../constants/errors');
const { createAppError } = require('../errors/AppError');
const { createAuditLog } = require('./audit-log.repository');

// Only hashes are stored: bcrypt for the OTP, SHA-256 for the reset token.
// `client` is the prisma client or a transaction client. meta: { ipAddress?, userAgent? }.

const createOtp = (client, { userId, otpHash, expiresAt, ipAddress }) =>
  client.passwordResetOtp.create({
    data: { id: crypto.randomUUID(), userId, otpHash, expiresAt, ipAddress },
  });

// Closes every OTP of the user that is still open (not used, not already invalidated).
const invalidateOpenOtps = (client, userId, now) =>
  client.passwordResetOtp.updateMany({
    where: { userId, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });

const findLatestByUserId = (userId) =>
  prisma.passwordResetOtp.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

// Includes the user's id, email and status so the service can check the account too.
const findLatestByEmail = (email) =>
  prisma.passwordResetOtp.findFirst({
    where: { user: { email } },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true, status: true } } },
  });

// Atomic increment, so parallel wrong guesses cannot skip the attempt limit.
const incrementAttempts = (id) =>
  prisma.passwordResetOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

const invalidateOtp = (id, now) =>
  prisma.passwordResetOtp.update({ where: { id }, data: { invalidatedAt: now } });

// Verified + token hash saved and audit row written: all commit together or not at all.
const markVerifiedTx = ({ otpId, userId, email, resetTokenHash, now, meta = {} }) =>
  prisma.$transaction(async (tx) => {
    await tx.passwordResetOtp.update({
      where: { id: otpId },
      data: { verifiedAt: now, resetTokenHash },
    });
    await createAuditLog(tx, {
      userId,
      action: AuditAction.PASSWORD_RESET_OTP_VERIFIED,
      email,
      meta,
    });
  });

// Old OTPs closed, new OTP stored and audit row written: all commit together or not at all.
const createOtpTx = ({ userId, email, otpHash, expiresAt, now, meta = {} }) =>
  prisma.$transaction(async (tx) => {
    await invalidateOpenOtps(tx, userId, now);
    const otp = await createOtp(tx, { userId, otpHash, expiresAt, ipAddress: meta.ipAddress });
    await createAuditLog(tx, {
      userId,
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      email,
      meta,
    });

    return { otpId: otp.id };
  });

// OTP marked used, new password saved, all active sessions revoked and audit row written:
// all commit together or not at all.
// The OTP update comes first and only matches an unused OTP, so when two requests race with the
// same token the loser throws before it changes anything and its transaction rolls back.
const resetPasswordTx = ({ otpId, userId, email, passwordHash, now, meta = {} }) =>
  prisma.$transaction(async (tx) => {
    const marked = await tx.passwordResetOtp.updateMany({
      where: { id: otpId, usedAt: null },
      data: { usedAt: now },
    });
    if (marked.count === 0) {
      throw createAppError(AppErrors.OTP_ALREADY_USED);
    }
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await tx.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await createAuditLog(tx, {
      userId,
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      email,
      meta,
    });
  });

module.exports = {
  createOtp,
  invalidateOpenOtps,
  findLatestByUserId,
  findLatestByEmail,
  incrementAttempts,
  invalidateOtp,
  markVerifiedTx,
  createOtpTx,
  resetPasswordTx,
};
