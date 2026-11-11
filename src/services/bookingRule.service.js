const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { AuditAction } = require('../constants/audit');
const {
  API_TO_DB_CATEGORY,
  API_TO_DB_UNIT,
  DB_TO_API_UNIT,
  findCatalogueEntry,
} = require('../constants/bookingRule');
const {
  findAll,
  findById,
  findByRuleKey,
  createRuleWithAudit,
  updateRuleWithAudit,
  deleteRuleWithAudit,
} = require('../repositories/bookingRule.repository');
const { toRuleResponse, toGroupedResponse } = require('../repositories/bookingRule.mapper');
const { findValueProblem } = require('../validators/bookingRule.validation');
const { isUniqueConstraintError, orNotFound } = require('../utils/prismaError.util');

const auditBase = (action, actor, meta) => ({
  action,
  actorId: actor.id,
  actorRole: actor.role,
  email: actor.email,
  userId: null,
  meta,
});

// ---- Reading (also used by enforcement code) ------------------------------------------------

const listBookingRules = async () => toGroupedResponse(await findAll());

// The saved rule, or null when it was deleted. Disabled rules are returned too: whether a
// disabled rule means "no restriction" or "feature off" depends on its kind (see below).
const getRule = async (ruleKey) => {
  return findByRuleKey(ruleKey);
};

// FEATURE rules: on only when the rule exists and is enabled. A deleted rule means off.
const isFeatureEnabled = async (ruleKey) => {
  const rule = await getRule(ruleKey);
  return rule !== null && rule.enabled;
};

// LIMIT rules: the value to enforce, or null for "no restriction" (disabled or deleted).
const getLimitValue = async (ruleKey) => {
  const rule = await getRule(ruleKey);
  return rule !== null && rule.enabled ? rule.value : null;
};

// ---- Writing --------------------------------------------------------------------------------

const createBookingRule = async ({ actor, payload, meta }) => {
  const entry = findCatalogueEntry(payload.ruleKey);
  const data = {
    ruleKey: entry.ruleKey,
    category: API_TO_DB_CATEGORY[entry.category],
    name: entry.name,
    value: payload.value ?? entry.defaultValue,
    unit: entry.unit ? API_TO_DB_UNIT[entry.unit] : null,
    enabled: payload.enabled ?? entry.defaultEnabled,
  };

  const auditFor = (rule) => ({
    ...auditBase(AuditAction.BOOKING_RULE_CREATED, actor, meta),
    details: { ruleKey: rule.ruleKey, value: rule.value, enabled: rule.enabled },
  });

  try {
    return toRuleResponse(await createRuleWithAudit({ data, auditFor }));
  } catch (err) {
    if (isUniqueConstraintError(err)) throw createAppError(AppErrors.BOOKING_RULE_ALREADY_EXISTS);
    throw err;
  }
};

const assertValueFits = (rule, value) => {
  const problem = findValueProblem(value, rule.unit ? DB_TO_API_UNIT[rule.unit] : null);
  if (!problem) return;
  throw createAppError(400, Messages.VALIDATION_FAILED, AppErrors.VALIDATION_ERROR.code, [
    { field: 'value', message: problem },
  ]);
};

const describeChanges = (rule, data) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([field, next]) => rule[field] !== next)
      .map(([field, next]) => [field, { from: rule[field], to: next }]),
  );

const updateBookingRule = async ({ actor, id, changes, meta }) => {
  const rule = await findById(id);
  if (!rule) throw createAppError(AppErrors.BOOKING_RULE_NOT_FOUND);

  if (changes.value !== undefined) assertValueFits(rule, changes.value);

  const data = {};
  if (changes.value !== undefined) data.value = changes.value;
  if (changes.enabled !== undefined) data.enabled = changes.enabled;

  const diff = describeChanges(rule, data);
  // Nothing would change, so nothing is written and no audit row is added.
  if (Object.keys(diff).length === 0) return toRuleResponse(rule);

  const auditFor = (updated) => ({
    ...auditBase(AuditAction.BOOKING_RULE_UPDATED, actor, meta),
    details: { ruleKey: updated.ruleKey, changes: diff },
  });

  const updated = await orNotFound(
    () => updateRuleWithAudit({ id, data, auditFor }),
    AppErrors.BOOKING_RULE_NOT_FOUND,
  );
  return toRuleResponse(updated);
};

const deleteBookingRule = async ({ actor, id, meta }) => {
  const rule = await findById(id);
  if (!rule) throw createAppError(AppErrors.BOOKING_RULE_NOT_FOUND);

  const auditFor = (deleted) => ({
    ...auditBase(AuditAction.BOOKING_RULE_DELETED, actor, meta),
    details: { ruleKey: deleted.ruleKey, value: deleted.value, enabled: deleted.enabled },
  });

  await orNotFound(() => deleteRuleWithAudit({ id, auditFor }), AppErrors.BOOKING_RULE_NOT_FOUND);
};

module.exports = {
  listBookingRules,
  getRule,
  isFeatureEnabled,
  getLimitValue,
  createBookingRule,
  updateBookingRule,
  deleteBookingRule,
};
