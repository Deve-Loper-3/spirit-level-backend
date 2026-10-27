const crypto = require('crypto');
const prisma = require('../config/prisma');

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

const listWithPlans = async (client = prisma) => {
  return client.membership.findMany({
    include: {
      plans: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
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
  listWithPlans,
  deleteTestMemberships,
};
