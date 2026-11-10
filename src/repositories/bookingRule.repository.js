const crypto = require('crypto');
const prisma = require('../config/prisma');
const { createAuditLog } = require('./audit-log.repository');

const findAll = async (client = prisma) => client.bookingRule.findMany();

const findById = async (id, client = prisma) => client.bookingRule.findUnique({ where: { id } });

const findByRuleKey = async (ruleKey, client = prisma) =>
  client.bookingRule.findUnique({ where: { ruleKey } });

// `auditFor(row)` builds the audit data once the row is known, so the rule and its audit row are
// written in one transaction.
const createRuleWithAudit = async ({ data, auditFor }, client = prisma) =>
  client.$transaction(async (tx) => {
    const rule = await tx.bookingRule.create({ data: { id: crypto.randomUUID(), ...data } });
    await createAuditLog(tx, { ...auditFor(rule), reason: `${rule.ruleKey} (${rule.id})` });
    return rule;
  });

// Throws P2025 when the row was deleted after the caller read it.
const updateRuleWithAudit = async ({ id, data, auditFor }, client = prisma) =>
  client.$transaction(async (tx) => {
    const rule = await tx.bookingRule.update({ where: { id }, data });
    await createAuditLog(tx, { ...auditFor(rule), reason: `${rule.ruleKey} (${rule.id})` });
    return rule;
  });

// Throws P2025 when the row is already gone.
const deleteRuleWithAudit = async ({ id, auditFor }, client = prisma) =>
  client.$transaction(async (tx) => {
    const rule = await tx.bookingRule.delete({ where: { id } });
    await createAuditLog(tx, { ...auditFor(rule), reason: `${rule.ruleKey} (${rule.id})` });
    return rule;
  });

module.exports = {
  findAll,
  findById,
  findByRuleKey,
  createRuleWithAudit,
  updateRuleWithAudit,
  deleteRuleWithAudit,
};
