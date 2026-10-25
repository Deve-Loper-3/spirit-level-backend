const crypto = require('crypto');
const prisma = require('../config/prisma');
const { PlanStatus } = require('../constants/membershipPlan');
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

const findActiveByName = async (name, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.membershipPlan.findFirst({
    where: {
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
  createPlanWithAudit,
};
