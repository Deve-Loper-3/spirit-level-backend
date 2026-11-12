const crypto = require('crypto');
const prisma = require('../config/prisma');
const { createAuditLog } = require('./audit-log.repository');

const findById = async (id, client = prisma) => {
  if (!id) return null;
  return client.membership.findUnique({
    where: { id },
  });
};

const findByName = async (name, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.membership.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
    },
  });
};

const create = async (data, client = prisma) => {
  return client.membership.create({
    data: {
      id: data.id || crypto.randomUUID(),
      name: data.name.trim(),
      description: data.description ? data.description.trim() : null,
    },
  });
};

// The membership and its audit row are written in ONE transaction: both are saved or neither.
// `auditData` carries the actor columns (see toAuditActor), the action and the request meta.
const createWithAudit = ({ data, auditData }, client = prisma) =>
  client.$transaction(async (tx) => {
    const membership = await create(data, tx);
    await createAuditLog(tx, {
      ...auditData,
      reason: `${membership.name} (${membership.id})`,
    });
    return membership;
  });

// A membership with its plans, in the same order everywhere. `_count` gives the number of plans
// from the database, so `planCount` never depends on how many plans were loaded.
const WITH_PLANS = Object.freeze({
  plans: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  _count: { select: { plans: true } },
});

// One page of memberships (oldest first, id as tie-break so pages never overlap) and the total,
// in two queries however many memberships there are.
const listPage = async ({ skip, take }, client = prisma) => {
  const [rows, total] = await Promise.all([
    client.membership.findMany({
      include: WITH_PLANS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    client.membership.count(),
  ]);
  return { rows, total };
};

const findByIdWithPlans = async (id, client = prisma) => {
  if (!id) return null;
  return client.membership.findUnique({ where: { id }, include: WITH_PLANS });
};

const deleteTestMemberships = async (prefix, client = prisma) => {
  return client.membership.deleteMany({
    where: {
      name: {
        startsWith: prefix,
        mode: 'insensitive',
      },
    },
  });
};

module.exports = {
  findById,
  findByName,
  create,
  createWithAudit,
  listPage,
  findByIdWithPlans,
  deleteTestMemberships,
};
