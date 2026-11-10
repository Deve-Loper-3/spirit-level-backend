const prisma = require('../../src/config/prisma');
const { findCatalogueEntry } = require('../../src/constants/bookingRule');
const { toSeedRow } = require('../../prisma/seeds/bookingRules.seed');

// Booking rules are global (no test prefix), so a suite that changes them takes a snapshot first
// and restores it in afterAll.
const snapshotBookingRules = async (client = prisma) => client.bookingRule.findMany();

const restoreBookingRules = async (rows, client = prisma) => {
  await client.bookingRule.deleteMany();
  if (rows.length > 0) {
    await client.bookingRule.createMany({ data: rows });
  }
};

// Creates or updates one rule from its catalogue defaults; `overrides` use DB column names
// (for example { enabled: true, value: 5 }).
const setTestRule = async (ruleKey, overrides = {}, client = prisma) => {
  const { id, ...data } = { ...toSeedRow(findCatalogueEntry(ruleKey)), ...overrides };
  return client.bookingRule.upsert({
    where: { ruleKey },
    update: data,
    create: { id, ...data },
  });
};

const removeTestRule = async (ruleKey, client = prisma) =>
  client.bookingRule.deleteMany({ where: { ruleKey } });

// The audit rows the API wrote for these actors (authenticate does not load an email, so they are
// found by actorId).
const BOOKING_RULE_AUDIT_ACTIONS = [
  'BOOKING_RULE_CREATED',
  'BOOKING_RULE_UPDATED',
  'BOOKING_RULE_DELETED',
];

const findBookingRuleAudits = async (action, actorId, client = prisma) =>
  client.auditLog.findMany({ where: { action, actorId }, orderBy: { createdAt: 'asc' } });

const deleteBookingRuleAudits = async (actorIds, client = prisma) =>
  client.auditLog.deleteMany({
    where: { action: { in: BOOKING_RULE_AUDIT_ACTIONS }, actorId: { in: actorIds } },
  });

module.exports = {
  snapshotBookingRules,
  restoreBookingRules,
  setTestRule,
  removeTestRule,
  findBookingRuleAudits,
  deleteBookingRuleAudits,
};
