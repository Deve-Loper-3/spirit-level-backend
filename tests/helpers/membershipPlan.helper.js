const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

const deleteTestPlans = async (prefix, client = prisma) => {
  return client.membershipPlan.deleteMany({
    where: {
      name: {
        startsWith: prefix,
        mode: 'insensitive',
      },
    },
  });
};

// Plan audit rows keep "<plan name> (<plan id>)" in `reason`, so the name prefix finds them.
const deleteTestPlanAudits = async (prefix, client = prisma) => {
  return client.auditLog.deleteMany({
    where: {
      reason: {
        startsWith: prefix,
        mode: 'insensitive',
      },
    },
  });
};

// A valid class subscription in the database; `overrides` change any column. The name always
// starts with `prefix`, so the cleanup helpers above remove it.
const createTestPlan = (prefix, overrides = {}, client = prisma) => {
  return client.membershipPlan.create({
    data: {
      id: crypto.randomUUID(),
      name: `${prefix}${crypto.randomUUID()}`,
      kind: 'SUBSCRIPTION',
      price: 100,
      billingCycle: 'MONTH',
      creditType: 'CLASS',
      creditsIncluded: 10,
      creditRefill: 'MONTHLY',
      validityValue: 1,
      validityUnit: 'MONTH',
      startsOn: 'PURCHASE_DATE',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      description: 'original description',
      ...overrides,
    },
  });
};

const findPlanAudits = (planId, action, client = prisma) => {
  return client.auditLog.findMany({
    where: { action, reason: { endsWith: `(${planId})` } },
    orderBy: { createdAt: 'asc' },
  });
};

module.exports = {
  deleteTestPlans,
  deleteTestPlanAudits,
  createTestPlan,
  findPlanAudits,
};
