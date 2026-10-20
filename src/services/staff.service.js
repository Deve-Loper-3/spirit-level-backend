const crypto = require('crypto');
const prisma = require('../config/prisma');
const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const { Messages } = require('../constants/messages');
const { Role } = require('../constants/roles');
const { CoachStatus, UserStatusByCoachStatus } = require('../constants/coach');
const { hashPassword, generateTempPassword } = require('../utils/password.util');
const { canCreate } = require('./staff.policies');
const { toStaffResponse } = require('../repositories/staff.mapper');
const { toCoachResponse } = require('../repositories/coach.mapper');
const { findByEmail } = require('../repositories/user.repository');
const logger = require('../config/logger');
const { createStaffUser } = require('../repositories/staff.repository');
const { createCoachProfile } = require('../repositories/coach.repository');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { sendStaffInvitation } = require('../infra/mail/notify.service');

// Shared by every staff-like account. `duplicateError` is what a taken email answers with;
// `createProfile(tx, user)` is an optional hook that runs inside the same transaction.
const registerStaffUser = async (
  actor,
  payload,
  requestMeta,
  { duplicateError = AppErrors.USER_ALREADY_EXISTS, createProfile } = {},
) => {
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
    throw createAppError(duplicateError);
  }

  // 3. Generate credentials: UUID, CSPRNG temporary password, BCrypt hash
  const userId = crypto.randomUUID();
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // 4. Atomic transaction: create user + optional profile + record STAFF_CREATED audit log
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await createStaffUser({ ...payload, id: userId, passwordHash }, tx);
      const profile = createProfile ? await createProfile(tx, user) : undefined;

      await createAuditLog(tx, {
        userId: user.id,
        action: AuditAction.STAFF_CREATED,
        email: user.email,
        actorId: actor.id,
        actorRole: actor.role,
        meta: requestMeta,
      });

      return { user, profile };
    });
  } catch (err) {
    // 5. Map concurrent unique-constraint race error to the duplicate-email 409
    if (isUniqueConstraintError(err)) {
      throw createAppError(duplicateError);
    }
    throw err;
  }

  // 6. Post-commit email hook:
  // Send staff invitation email with tempPassword after transaction commits.
  // Failure must be caught and logged (never logging tempPassword or email body),
  // must not roll back the user, and must not fail the request.
  const { user: createdUser } = created;
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

  return { ...created, tempPassword, emailSent };
};

const createStaff = async (actor, payload, requestMeta) => {
  const { user, tempPassword, emailSent } = await registerStaffUser(actor, payload, requestMeta);

  return {
    user: toStaffResponse(user),
    tempPassword,
    emailSent,
  };
};

// A coach is a COACH user plus a Coach profile. The image is stored on the user.
const createCoach = async (actor, payload, requestMeta) => {
  const { coachType, bio, status = CoachStatus.ACTIVE, ...userFields } = payload;

  const { user, profile, emailSent } = await registerStaffUser(
    actor,
    { ...userFields, role: Role.COACH, status: UserStatusByCoachStatus[status] },
    requestMeta,
    {
      duplicateError: AppErrors.COACH_EMAIL_ALREADY_EXISTS,
      createProfile: (tx, createdUser) =>
        createCoachProfile(
          { id: crypto.randomUUID(), userId: createdUser.id, coachType, bio, status },
          tx,
        ),
    },
  );

  return { coach: toCoachResponse(user, profile), emailSent };
};

module.exports = { createStaff, createCoach };
