const crypto = require('crypto');
const prisma = require('../config/prisma');

const findById = async (id, client = prisma) => {
  if (!id) return null;
  return client.cafeItem.findUnique({
    where: { id },
    include: {
      category: true,
    },
  });
};

const findByName = async (name, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.cafeItem.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
    },
    include: {
      category: true,
    },
  });
};

const findByNameExcludingId = async (name, excludeId, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.cafeItem.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
      NOT: { id: excludeId },
    },
    include: {
      category: true,
    },
  });
};

const listItems = async (
  { where = {}, skip = 0, take = 20, orderBy = { name: 'asc' } } = {},
  client = prisma,
) => {
  return client.cafeItem.findMany({
    where,
    skip,
    take,
    orderBy,
    include: {
      category: true,
    },
  });
};

const countItems = async (where = {}, client = prisma) => {
  return client.cafeItem.count({ where });
};

const create = async (data, client = prisma) => {
  return client.cafeItem.create({
    data: {
      id: data.id || crypto.randomUUID(),
      name: data.name.trim(),
      categoryId: data.categoryId,
      description: data.description ? data.description.trim() : null,
      nutrition: data.nutrition ?? undefined,
      priceAed: data.priceAed,
      imageUrl: data.imageUrl ?? null,
      availability: data.availability,
      visibility: data.visibility,
      isTracked: data.isTracked,
      stockQuantity: data.stockQuantity,
      unitCost: data.unitCost,
      externalRef: data.externalRef ?? null,
    },
    include: {
      category: true,
    },
  });
};

const update = async (id, data, client = prisma) => {
  return client.cafeItem.update({
    where: { id },
    data,
    include: {
      category: true,
    },
  });
};

const findByExternalRef = async (externalRef, client = prisma) => {
  if (!externalRef) return null;
  return client.cafeItem.findUnique({
    where: { externalRef },
    include: {
      category: true,
    },
  });
};

const upsertByExternalRef = async ({ externalRef, data, client = prisma }) => {
  return client.cafeItem.upsert({
    where: { externalRef },
    update: data,
    create: {
      id: crypto.randomUUID(),
      externalRef,
      ...data,
    },
    include: {
      category: true,
    },
  });
};

module.exports = {
  findById,
  findByName,
  findByNameExcludingId,
  findByExternalRef,
  listItems,
  countItems,
  create,
  update,
  upsertByExternalRef,
};
