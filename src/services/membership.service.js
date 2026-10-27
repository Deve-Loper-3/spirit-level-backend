const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const {
  findByName,
  create,
  listWithPlans,
} = require('../repositories/membership.repository');
const { toMembershipPlanResponse } = require('../repositories/membershipPlan.mapper');

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

const createMembership = async ({ payload }) => {
  const trimmedName = (payload.name || '').trim();

  const existing = await findByName(trimmedName);
  if (existing) {
    throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
  }

  try {
    const created = await create({
      name: trimmedName,
      description: payload.description,
    });
    return {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      createdAt: created.createdAt,
      planCount: 0,
      plans: [],
    };
  } catch (err) {
    if (isMembershipNameUniqueError(err)) {
      throw createAppError(AppErrors.MEMBERSHIP_EXISTS);
    }
    throw err;
  }
};

const listMemberships = async () => {
  const rows = await listWithPlans();
  return rows.map((m) => {
    const membershipInfo = {
      id: m.id,
      name: m.name,
      description: m.description ?? null,
    };
    return {
      id: m.id,
      name: m.name,
      description: m.description ?? null,
      createdAt: m.createdAt,
      planCount: (m.plans || []).length,
      plans: (m.plans || []).map((p) =>
        toMembershipPlanResponse({
          ...p,
          membership: membershipInfo,
        }),
      ),
    };
  });
};

module.exports = {
  isMembershipNameUniqueError,
  createMembership,
  listMemberships,
};
