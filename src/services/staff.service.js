const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const { Messages } = require('../constants/messages');
const { hashPassword, generateTempPassword } = require('../utils/password.util');
const { canCreate } = require('./staff.policies');
const { toStaffResponse } = require('../repositories/staff.mapper');
const { findByEmail } = require('../repositories/user.repository');
const logger = require('../config/logger');
const { createStaffUser } = require('../repositories/staff.repository');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { sendStaffInvitation } = require('../infra/mail/notify.service');

const isUniqueConstraintError = (err) =>
  (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
  err?.code === 'P2002';

const createStaff = async (actor, payload, requestMeta) => {
  // 1. Role creation authorization check
  if (!canCreate(actor?.role, payload.role)) {
    const reason = Messages.STAFF_CREATE_DENIED_REASON(actor?.role, payload.role);
    await createAuditLog(prisma, {
      action: AuditAction.STAFF_CREATE_DENIED,
      actorId: actor?.id,
      actorRole: actor?.role,
      reason,
      email: payload.email,
      meta: requestMeta,
    });
    throw createAppError(AppErrors.STAFF_ROLE_NOT_ALLOWED);
  }

  // 2. Duplicate email check (phone is intentionally not checked for uniqueness)
  const existingUser = await findByEmail(payload.email);
  if (existingUser) {
    throw createAppError(AppErrors.USER_ALREADY_EXISTS);
  }

  // 3. Generate credentials: UUID, CSPRNG temporary password, BCrypt hash
  const userId = crypto.randomUUID();
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // 4. Atomic transaction: create staff user + record STAFF_CREATED audit log
  let createdUser;
  try {
    createdUser = await prisma.$transaction(async (tx) => {
      const user = await createStaffUser(
        {
          id: userId,
          fullName: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          role: payload.role,
          passwordHash,
        },
        tx,
      );

      await createAuditLog(tx, {
        userId: user.id,
        action: AuditAction.STAFF_CREATED,
        email: user.email,
        actorId: actor.id,
        actorRole: actor.role,
        meta: requestMeta,
      });

      return user;
    });
  } catch (err) {
    // 5. Map concurrent unique-constraint race error to 409 USER_ALREADY_EXISTS
    if (isUniqueConstraintError(err)) {
      throw createAppError(AppErrors.USER_ALREADY_EXISTS);
    }
    throw err;
  }

  // 6. Post-commit email hook:
  // Send staff invitation email with tempPassword after transaction commits.
  // Failure must be caught and logged (never logging tempPassword or email body),
  // must not roll back the user, and must not fail the request.
  let emailSent = false;
  try {
    await sendStaffInvitation(
      {
        email: createdUser.email,
        fullName: createdUser.fullName,
        role: createdUser.role,
      },
      tempPassword,
    );
    emailSent = true;
  } catch (err) {
    logger.error(
      {
        userId: createdUser.id,
        email: createdUser.email,
        errorName: err.name,
        errorCode: err.code,
      },
      Messages.STAFF_INVITATION_EMAIL_FAILED,
    );
  }

  return {
    user: toStaffResponse(createdUser),
    tempPassword,
    emailSent,
  };
};

module.exports = { createStaff };
