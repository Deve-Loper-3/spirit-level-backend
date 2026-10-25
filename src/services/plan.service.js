const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const { PlanStatus, PlanCreditType } = require('../constants/membershipPlan');
const {
  findActiveByName,
  createPlanWithAudit,
} = require('../repositories/membershipPlan.repository');
const { toMembershipPlanResponse } = require('../repositories/membershipPlan.mapper');

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

const createPlan = async ({ actor, payload, meta }) => {
  const trimmedName = payload.name.trim();

  // 1. Check duplicate name among active / non-archived plans (case-insensitive)
  const existing = await findActiveByName(trimmedName);
  if (existing) {
    throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
  }

  // 2. Normalize and enforce status = ACTIVE, version = 1, strip externalRef
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
  };

  const auditData = {
    action: AuditAction.PLAN_CREATED,
    actorId: actor?.id,
    actorRole: actor?.role,
    email: actor?.email,
    userId: null,
    meta,
  };

  try {
    const created = await createPlanWithAudit({ planData, auditData });
    return toMembershipPlanResponse(created, { activeClientCount: 0 });
  } catch (err) {
    if (isPlanNameUniqueError(err)) {
      throw createAppError(AppErrors.PLAN_DUPLICATE_NAME);
    }
    throw err;
  }
};

module.exports = {
  createPlan,
  isPlanNameUniqueError,
};
