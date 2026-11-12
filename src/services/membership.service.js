const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const {
  findByName,
  createWithAudit,
  listPage,
  findByIdWithPlans,
} = require('../repositories/membership.repository');
const { toMembershipPlanResponse } = require('../repositories/membershipPlan.mapper');
const { toAuditActor } = require('../utils/actor.util');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');

const isMembershipNameUniqueError = (err) => {
  if (!isUniqueConstraintError(err)) return false;
  const target = err.meta?.target;
  if (!target) return true;
  const targets = Array.isArray(target) ? target : [target];
  return targets.some(
    (t) =>
      typeof t === 'string' &&
      !t.includes('membership_plans') &&
      (t.includes('memberships_name_lower_idx') ||
        t.includes('memberships_name_key') ||
        t === 'name'),
  );
};

const createMembership = async ({ actor, payload, meta }) => {
  const trimmedName = (payload.name || '').trim();

  const existing = await findByName(trimmedName);
  if (existing) {
    throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
  }

  try {
    const created = await createWithAudit({
      data: { name: trimmedName, description: payload.description },
      auditData: {
        action: AuditAction.MEMBERSHIP_CREATED,
        ...toAuditActor(actor),
        userId: null,
        meta,
      },
    });
    return toMembershipResponse({ ...created, plans: [] });
  } catch (err) {
    if (isMembershipNameUniqueError(err)) {
      throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
    }
    throw err;
  }
};

// One shape for a membership everywhere (create, list item, get by id): the membership, its plan
// count and its plans in the full plan view.
const toMembershipResponse = (row) => {
  const membershipInfo = { id: row.id, name: row.name, description: row.description ?? null };
  const plans = row.plans || [];
  return {
    ...membershipInfo,
    createdAt: row.createdAt,
    planCount: row._count?.plans ?? plans.length,
    plans: plans.map((plan) => toMembershipPlanResponse({ ...plan, membership: membershipInfo })),
  };
};

const listMemberships = async ({ query }) => {
  const { page, limit } = query;
  const { rows, total } = await listPage(toSkipTake({ page, limit }));
  return {
    memberships: rows.map(toMembershipResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getMembership = async (id) => {
  const row = await findByIdWithPlans(id);
  if (!row) throw createAppError(AppErrors.MEMBERSHIP_NOT_FOUND);
  return toMembershipResponse(row);
};

module.exports = {
  isMembershipNameUniqueError,
  createMembership,
  listMemberships,
  getMembership,
  toMembershipResponse,
};
