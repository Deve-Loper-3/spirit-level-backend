const prisma = require('../config/prisma');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const {
  CoachStatus,
  UserStatusTransitionByCoachStatus,
  COACH_USER_FIELDS,
  COACH_PROFILE_FIELDS,
} = require('../constants/coach');
const {
  findCoachById,
  findCoachByUserId,
  listCoaches: findCoaches,
  updateCoachWithUser,
  updateCoachStatus,
} = require('../repositories/coach.repository');
const { findByEmail, updateStatusIfCurrent } = require('../repositories/user.repository');
const { revokeAllByUser } = require('../repositories/session.repository');
const { createAuditLog } = require('../repositories/audit-log.repository');
const {
  getListAccess,
  selectCoachView,
  toFullView,
  assertCanSee,
  assertCanEdit,
  assertManager,
  editableFields,
} = require('./coach.access');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');
const { pick } = require('../utils/pick.util');
const { isUniqueConstraintError, isRecordNotFoundError } = require('../utils/prismaError.util');

const requireCoach = async (coachId) => {
  const coach = await findCoachById(coachId);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  return coach;
};

// A taken email is a 409; a coach deleted between the read and the write is a 404.
const mapWriteError = (err) => {
  if (isUniqueConstraintError(err)) return createAppError(AppErrors.COACH_EMAIL_ALREADY_EXISTS);
  if (isRecordNotFoundError(err)) return createAppError(AppErrors.COACH_NOT_FOUND);
  return err;
};

// The coach's own current email is not a conflict.
const assertEmailAvailable = async (email, ownUserId) => {
  if (!email) return;
  const existing = await findByEmail(email);
  if (existing && existing.id !== ownUserId) {
    throw createAppError(AppErrors.COACH_EMAIL_ALREADY_EXISTS);
  }
};

// The caller's role decides the view, the filters and the search fields (see coach.access),
// whatever the route let through.
const listCoaches = async ({ caller, query }) => {
  const { page, limit, search } = query;
  const access = getListAccess(caller.role);

  const { rows, total } = await findCoaches({
    ...access.filtersOf(query),
    search,
    searchFields: access.searchFields,
    ...toSkipTake({ page, limit }),
  });

  return { coaches: rows.map(access.toView), pagination: buildPagination({ page, limit, total }) };
};

const getCoach = async ({ caller, coachId }) => {
  const coach = await requireCoach(coachId);
  assertCanSee(caller, coach);
  return selectCoachView(caller, coach);
};

const getMyCoach = async (caller) => {
  const coach = await findCoachByUserId(caller.id);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  return toFullView(coach);
};

// `allowedFields` is what the route offers; it is capped again by the caller's role. Callers other
// than managers may only edit their own profile. User and coach columns change in one
// transaction together with the audit row, which stores field NAMES only, never values.
const updateCoach = async ({ actor, coachId, changes, allowedFields, meta }) => {
  const coach = await requireCoach(coachId);
  assertCanEdit(actor, coach);

  const allowed = pick(changes, editableFields(actor.role, allowedFields));
  await assertEmailAvailable(allowed.email, coach.user.id);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await updateCoachWithUser(
        coachId,
        {
          userFields: pick(allowed, COACH_USER_FIELDS),
          coachFields: pick(allowed, COACH_PROFILE_FIELDS),
        },
        tx,
      );
      await createAuditLog(tx, {
        userId: row.user.id,
        action: AuditAction.COACH_UPDATED,
        reason: Object.keys(allowed).join(','),
        email: row.user.email,
        actorId: actor.id,
        actorRole: actor.role,
        meta,
      });
      return row;
    });
    return toFullView(updated);
  } catch (err) {
    throw mapWriteError(err);
  }
};

// Coach status and the linked user's status change together. Setting the status a coach already
// has writes nothing (no audit row, no session change). Deactivating also revokes every refresh
// session, so reactivating later does not bring old sessions back.
const setCoachStatus = async ({ actor, coachId, status, meta }) => {
  assertManager(actor);
  const coach = await requireCoach(coachId);

  const changed = await prisma.$transaction(async (tx) => {
    if (!(await updateCoachStatus(coachId, status, tx))) return false;

    await updateStatusIfCurrent(coach.user.id, UserStatusTransitionByCoachStatus[status], tx);
    if (status === CoachStatus.INACTIVE) await revokeAllByUser(coach.user.id, new Date(), tx);
    await createAuditLog(tx, {
      userId: coach.user.id,
      action: AuditAction.COACH_STATUS_CHANGED,
      reason: `${coach.status}->${status}`,
      email: coach.user.email,
      actorId: actor.id,
      actorRole: actor.role,
      meta,
    });
    return true;
  });

  return toFullView(changed ? await requireCoach(coachId) : coach);
};

module.exports = { listCoaches, getCoach, getMyCoach, updateCoach, setCoachStatus };
