const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const {
  PlanStatus,
  PlanCreditType,
  PlanSection,
  PLAN_KIND_LABELS,
  PLAN_LIST_DEFAULT_STATUSES,
} = require('../constants/membershipPlan');
const { escapeLikePattern } = require('../utils/like.util');
const { createAuditLog } = require('./audit-log.repository');

const upsertByExternalRef = async ({ externalRef, data, client = prisma }) => {
  return client.membershipPlan.upsert({
    where: { externalRef },
    update: data,
    create: {
      id: crypto.randomUUID(),
      externalRef,
      ...data,
    },
  });
};

const findById = async (id, client = prisma) => {
  return client.membershipPlan.findUnique({
    where: { id },
  });
};

const findByExternalRef = async (externalRef, client = prisma) => {
  if (!externalRef) return null;
  return client.membershipPlan.findUnique({
    where: { externalRef },
  });
};

const findByName = async (name, client = prisma) => {
  if (!name) return null;
  return client.membershipPlan.findFirst({
    where: {
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
  });
};

// `excludeId` leaves one plan out, so a plan never collides with its own name.
const findActiveByName = async (name, client = prisma, { excludeId } = {}) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.membershipPlan.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
      status: {
        not: PlanStatus.ARCHIVED,
      },
    },
  });
};

const updatePlan = async (id, data, client = prisma) => {
  return client.membershipPlan.update({
    where: { id },
    data,
  });
};

const SECTION_FILTERS = {
  [PlanSection.ONLINE_COACHING]: { creditType: PlanCreditType.TIME },
  [PlanSection.CLASS_MEMBERSHIP]: { creditType: { not: PlanCreditType.TIME } },
};

// Kinds whose label contains the text, so "trial" also finds kind TRIAL.
const kindsMatchingLabel = (text) => {
  const needle = text.toLowerCase();
  return Object.entries(PLAN_KIND_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([kind]) => kind);
};

const buildSearchFilter = (text) => {
  const contains = escapeLikePattern(text);
  const kinds = kindsMatchingLabel(text);
  return {
    OR: [
      { name: { contains, mode: 'insensitive' } },
      { description: { contains, mode: 'insensitive' } },
      ...(kinds.length > 0 ? [{ kind: { in: kinds } }] : []),
    ],
  };
};

// The only place list filters are defined; both list paths below use it.
// Archived plans are returned only when the caller asks for the status.
const buildListWhere = ({ section, kind, creditType, visibility, status, q }) => {
  const conditions = [{ status: { in: status ?? PLAN_LIST_DEFAULT_STATUSES } }];
  if (section) conditions.push(SECTION_FILTERS[section]);
  if (kind) conditions.push({ kind });
  if (creditType) conditions.push({ creditType });
  if (visibility) conditions.push({ visibility });
  if (q) conditions.push(buildSearchFilter(q));
  return { AND: conditions };
};

// The page and the total are read side by side: each database round trip is slow on the remote
// database, and a transaction would add three more.
const listByColumn = async ({ where, field, direction, skip, take }) => {
  const [rows, total] = await Promise.all([
    prisma.membershipPlan.findMany({
      where,
      orderBy: [{ [field]: direction }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.membershipPlan.count({ where }),
  ]);
  return { rows, total };
};

// The database collation (C.UTF-8) sorts "STRDY" before "Single", and Prisma cannot order by
// LOWER(name). So Prisma loads the matching plans (the same `where` as every other path), raw SQL
// only orders and pages their ids, and the rows are put in that order. The catalogue is small, so
// loading every match is fine; a LOWER(name) index is the later fix if it grows.
const listByNameOrder = async ({ where, direction, skip, take }) => {
  const matches = await prisma.membershipPlan.findMany({ where });
  const total = matches.length;
  if (skip >= total) return { rows: [], total };

  const order = direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const ids = matches.map((match) => match.id);
  const page = await prisma.$queryRaw`
    SELECT "id" FROM "membership_plans"
    WHERE "id" = ANY(${ids}::text[])
    ORDER BY LOWER("name") ${order}, "id" ASC
    LIMIT ${take} OFFSET ${skip}`;

  const byId = new Map(matches.map((plan) => [plan.id, plan]));
  return { rows: page.map((row) => byId.get(row.id)), total };
};

const listPlans = ({ filters, sort, skip, take }) => {
  const where = buildListWhere(filters);
  if (sort.field === 'name') {
    return listByNameOrder({ where, direction: sort.direction, skip, take });
  }
  return listByColumn({ where, field: sort.field, direction: sort.direction, skip, take });
};

// Non-archived plans per credit type; independent of every list filter so tab badges stay stable.
const countNonArchivedByCreditType = () =>
  prisma.membershipPlan.groupBy({
    by: ['creditType'],
    where: { status: { not: PlanStatus.ARCHIVED } },
    _count: { _all: true },
  });

// There is no purchases table yet, so no plan has active clients. The purchase ticket replaces
// this body; plan_in_use (and later activeClientCount) read from here.
const countActiveClients = async (_planId, _client = prisma) => 0;

// Updates a plan that is not archived and writes its audit row in the same transaction. The
// database trigger bumps `version` when a commercial field changes. `auditFor(updated)` builds
// the audit data once the new row is known. Returns null when the plan was archived meanwhile.
const updatePlanWithAudit = async ({ id, data, auditFor }, client = prisma) => {
  return client.$transaction(async (tx) => {
    const { count } = await tx.membershipPlan.updateMany({
      where: { id, status: { not: PlanStatus.ARCHIVED } },
      data,
    });
    if (count === 0) return null;

    const plan = await tx.membershipPlan.findUnique({ where: { id } });
    await createAuditLog(tx, { ...auditFor(plan), reason: `${plan.name} (${plan.id})` });
    return plan;
  });
};

// Moves a plan from `from` to `to` and writes the audit row in the same transaction. Returns
// null when the status is no longer `from` (someone else changed it first).
const changePlanStatusWithAudit = async ({ id, from, to, auditFor }, client = prisma) => {
  return client.$transaction(async (tx) => {
    const { count } = await tx.membershipPlan.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    if (count === 0) return null;

    const plan = await tx.membershipPlan.findUnique({ where: { id } });
    await createAuditLog(tx, { ...auditFor(plan), reason: `${plan.name} (${plan.id})` });
    return plan;
  });
};

const createPlanWithAudit = async ({ planData, auditData }, client = prisma) => {
  return client.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.create({
      data: {
        id: crypto.randomUUID(),
        ...planData,
        version: 1,
      },
    });

    if (auditData) {
      await createAuditLog(tx, {
        ...auditData,
        reason: `${plan.name} (${plan.id})`,
      });
    }

    return plan;
  });
};

module.exports = {
  upsertByExternalRef,
  findById,
  findByExternalRef,
  findByName,
  findActiveByName,
  updatePlan,
  buildListWhere,
  listPlans,
  countNonArchivedByCreditType,
  countActiveClients,
  updatePlanWithAudit,
  changePlanStatusWithAudit,
  createPlanWithAudit,
};
