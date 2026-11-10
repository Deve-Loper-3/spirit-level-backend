const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { AuditAction } = require('../constants/audit');
const {
  PlanStatus,
  PlanCreditType,
  PlanSection,
  PLAN_EDITABLE_FIELDS,
  PLAN_LIST_ITEM_FIELDS,
  PLAN_STATUS_TRANSITIONS,
} = require('../constants/membershipPlan');
const {
  findActiveByName,
  createPlanWithAudit,
  listPlans: findPlans,
  countNonArchivedByCreditType,
  countActiveClients,
  updatePlanWithAudit,
  changePlanStatusWithAudit,
} = require('../repositories/membershipPlan.repository');
const {
  findById: findMembershipById,
  findByName: findMembershipByName,
} = require('../repositories/membership.repository');
const { isMembershipNameUniqueError } = require('./membership.service');
const {
  toMembershipPlanResponse,
  toSection,
  toEditableFields,
} = require('../repositories/membershipPlan.mapper');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');
const { pick } = require('../utils/pick.util');
const { findAuthWithEmailById } = require('../repositories/user.repository');

const isPlanNameUniqueError = (err) => {
  if (!isUniqueConstraintError(err)) return false;
  const target = err.meta?.target;
  if (!target) return true;
  if (Array.isArray(target)) {
    return target.some(
      (t) =>
        typeof t === 'string' &&
        (t.includes('name') || t.includes('membership_plans_name_lower_active_idx')),
    );
  }
  if (typeof target === 'string') {
    return target.includes('name') || target.includes('membership_plans_name_lower_active_idx');
  }
  return true;
};

// authenticate only attaches id/role/status; load email from DB for audit rows.
const resolveActorEmail = async (actor) => {
  if (actor?.email) return actor.email;
  if (!actor?.id) return null;
  const user = await findAuthWithEmailById(actor.id);
  return user?.email ?? null;
};

const createPlan = async ({ actor, payload, meta }) => {
  const trimmedName = payload.name.trim();

  // 1. Check duplicate name among active / non-archived plans (case-insensitive)
  const existing = await findActiveByName(trimmedName);
  if (existing) {
    throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
  }

  // 2. Membership mode resolution (3 modes)
  let finalMembershipId = null;
  let newMembershipData = null;

  if (payload.membershipId) {
    // Mode 1: Existing membership - verify it exists, else 400
    const mem = await findMembershipById(payload.membershipId);
    if (!mem) {
      throw createAppError(400, Messages.VALIDATION_FAILED, AppErrors.VALIDATION_ERROR.code, [
        { field: 'membershipId', message: Messages.MEMBERSHIP_NOT_FOUND },
      ]);
    }
    finalMembershipId = payload.membershipId;
  } else if (payload.membership && payload.membership.name && payload.membership.name.trim()) {
    // Mode 2: New membership
    const memName = payload.membership.name.trim();
    const existingMem = await findMembershipByName(memName);
    if (existingMem) {
      throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
    }
    newMembershipData = {
      name: memName,
      description: payload.membership.description ? payload.membership.description.trim() : null,
    };
  } else {
    // Mode 3: Standalone (membershipId null)
    finalMembershipId = null;
  }

  // 3. Normalize and enforce status = ACTIVE, version = 1, strip externalRef
  const creditsIncluded = payload.creditType === PlanCreditType.TIME ? 0 : payload.creditsIncluded;

  const planData = {
    name: trimmedName,
    kind: payload.kind,
    price: payload.price,
    billingCycle: payload.billingCycle,
    creditType: payload.creditType,
    creditsIncluded,
    creditRefill: payload.creditRefill ?? null,
    validityValue: payload.validityValue,
    validityUnit: payload.validityUnit,
    startsOn: payload.startsOn,
    oneTimePurchasePerClient: Boolean(payload.oneTimePurchasePerClient),
    visibility: payload.visibility,
    status: PlanStatus.ACTIVE,
    description: payload.description ?? null,
    term: payload.term ?? null,
    recurring: Boolean(payload.recurring),
    periodMonths:
      payload.periodMonths !== null && payload.periodMonths !== undefined
        ? Number(payload.periodMonths)
        : null,
    joiningFee:
      payload.joiningFee !== null && payload.joiningFee !== undefined ? payload.joiningFee : 0,
    membershipId: finalMembershipId,
  };

  const auditData = {
    action: AuditAction.PLAN_CREATED,
    actorId: actor?.id,
    actorRole: actor?.role,
    email: await resolveActorEmail(actor),
    userId: null,
    meta,
  };

  try {
    const created = await createPlanWithAudit({ planData, auditData, newMembershipData });
    return toMembershipPlanResponse(created, { activeClientCount: 0 });
  } catch (err) {
    if (newMembershipData && isMembershipNameUniqueError(err)) {
      throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
    }
    if (isPlanNameUniqueError(err)) {
      throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
    }
    throw err;
  }
};

// Both sections are always present, 0 when a section has no plans.
const toSectionCounts = (groups) => {
  const counts = { [PlanSection.CLASS_MEMBERSHIP]: 0, [PlanSection.ONLINE_COACHING]: 0 };
  groups.forEach((group) => {
    counts[toSection(group.creditType)] += group._count._all;
  });
  return counts;
};

const listPlans = async ({ query }) => {
  const { page, limit, sort, ...filters } = query;

  // The counts query ignores every filter, so it runs next to the list query.
  const [{ rows, total }, groups] = await Promise.all([
    findPlans({ filters, sort, ...toSkipTake({ page, limit }) }),
    countNonArchivedByCreditType(),
  ]);

  return {
    plans: rows.map((plan) =>
      pick(toMembershipPlanResponse(plan, { activeClientCount: 0 }), PLAN_LIST_ITEM_FIELDS),
    ),
    pagination: buildPagination({ page, limit, total }),
    counts: toSectionCounts(groups),
  };
};

const getPlan = async ({ plan }) =>
  toMembershipPlanResponse(plan, { activeClientCount: await countActiveClients(plan.id) });

const isTimeBased = (creditType) => creditType === PlanCreditType.TIME;

// Names of the editable fields whose value differs.
const changedFields = (plan, next) => {
  const before = toEditableFields(plan);
  const after = toEditableFields(next);
  return PLAN_EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);
};

// A plan never collides with its own name; `excludeId` leaves it out.
const assertNameAvailable = async (name, planId) => {
  if (await findActiveByName(name, undefined, { excludeId: planId })) {
    throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
  }
};

// Switching between time-based and credit-based would break the credits clients already hold.
const assertCreditTypeChangeAllowed = async (plan, next) => {
  const switchesBasis = isTimeBased(plan.creditType) !== isTimeBased(next.creditType);
  if (switchesBasis && (await countActiveClients(plan.id)) > 0) {
    throw createAppError(AppErrors.PLAN_IN_USE);
  }
};

// Old and new value of each changed field, in the API's own format (lowercase, numeric price).
const describeChanges = (before, after, fields) =>
  Object.fromEntries(fields.map((field) => [field, { from: before[field], to: after[field] }]));

// `plan` was loaded (and checked not archived) by `loadPlan`; `next` is the validated result of
// the merge. Nothing is written when no value really changes: no version bump, no audit row.
const updatePlan = async ({ actor, plan, next, meta }) => {
  const fields = changedFields(plan, next);
  if (fields.length === 0) return getPlan({ plan });

  const data = pick(toEditableFields(next), fields);
  if (data.name) data.name = data.name.trim();

  if (fields.includes('name')) await assertNameAvailable(data.name, plan.id);
  if (fields.includes('creditType')) await assertCreditTypeChangeAllowed(plan, next);
  if (fields.includes('membershipId')) {
    if (data.membershipId) {
      const mem = await findMembershipById(data.membershipId);
      if (!mem) {
        throw createAppError(400, Messages.VALIDATION_FAILED, AppErrors.VALIDATION_ERROR.code, [
          { field: 'membershipId', message: Messages.MEMBERSHIP_NOT_FOUND },
        ]);
      }
    } else {
      data.membershipId = null;
    }
  }

  const actorEmail = await resolveActorEmail(actor);
  const auditFor = (updated) => ({
    action: AuditAction.PLAN_UPDATED,
    actorId: actor.id,
    actorRole: actor.role,
    email: actorEmail,
    userId: null,
    meta,
    details: {
      changes: describeChanges(
        toMembershipPlanResponse(plan),
        toMembershipPlanResponse(updated),
        fields,
      ),
      version: { from: plan.version, to: updated.version },
    },
  });

  try {
    const updated = await updatePlanWithAudit({ id: plan.id, data, auditFor });
    // The plan was archived between the read and the write.
    if (!updated) throw createAppError(AppErrors.PLAN_ARCHIVED);
    return getPlan({ plan: updated });
  } catch (err) {
    if (isPlanNameUniqueError(err)) throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
    throw err;
  }
};

const toStatusResponse = (plan) => ({
  id: plan.id,
  status: plan.status.toLowerCase(),
  updatedAt: plan.updatedAt,
});

// The same status again is a success that changes nothing (checked before the transition map).
// Leaving ARCHIVED makes the plan count for name uniqueness again, so the name is checked first.
const changePlanStatus = async ({ actor, plan, status, reason, meta }) => {
  if (plan.status === status) return toStatusResponse(plan);
  if (!PLAN_STATUS_TRANSITIONS[plan.status].includes(status)) {
    throw createAppError(AppErrors.PLAN_INVALID_TRANSITION);
  }
  if (plan.status === PlanStatus.ARCHIVED) await assertNameAvailable(plan.name, plan.id);

  const actorEmail = await resolveActorEmail(actor);
  const auditFor = () => ({
    action: AuditAction.PLAN_STATUS_CHANGED,
    actorId: actor.id,
    actorRole: actor.role,
    email: actorEmail,
    userId: null,
    meta,
    details: { from: plan.status.toLowerCase(), to: status.toLowerCase(), reason: reason ?? null },
  });

  try {
    const updated = await changePlanStatusWithAudit({
      id: plan.id,
      from: plan.status,
      to: status,
      auditFor,
    });
    // Someone changed the status between the read and the write.
    if (!updated) throw createAppError(AppErrors.PLAN_INVALID_TRANSITION);
    return toStatusResponse(updated);
  } catch (err) {
    if (isPlanNameUniqueError(err)) throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
    throw err;
  }
};

module.exports = {
  createPlan,
  getPlan,
  updatePlan,
  changePlanStatus,
  listPlans,
  toSectionCounts,
  isPlanNameUniqueError,
};
