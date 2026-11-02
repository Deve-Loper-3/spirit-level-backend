const crypto = require('crypto');
const prisma = require('../config/prisma');

const findById = async (id, client = prisma) => {
  if (!id) return null;
  return client.cafeCategory.findUnique({
    where: { id },
  });
};

const findByName = async (name, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.cafeCategory.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
    },
  });
};

const findByNameExcludingId = async (name, excludeId, client = prisma) => {
  if (!name) return null;
  const trimmed = name.trim();
  return client.cafeCategory.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: 'insensitive',
      },
      NOT: {
        id: excludeId,
      },
    },
  });
};

const listCategories = async ({ countPublicOnly = false } = {}, client = prisma) => {
  return client.cafeCategory.findMany({
    include: {
      _count: {
        select: {
          items: countPublicOnly
            ? {
                where: { visibility: 'PUBLIC' },
              }
            : true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });
};

const create = async (data, client = prisma) => {
  return client.cafeCategory.create({
    data: {
      id: data.id || crypto.randomUUID(),
      name: data.name.trim(),
      description: data.description ? data.description.trim() : null,
    },
  });
};

const update = async (id, data, client = prisma) => {
  const updateData = {};
  if (data.name !== undefined) {
    updateData.name = data.name.trim();
  }
  if (data.description !== undefined) {
    updateData.description = data.description ? data.description.trim() : null;
  }

  return client.cafeCategory.update({
    where: { id },
    data: updateData,
  });
};

const countItems = async (categoryId, client = prisma) => {
  return client.cafeItem.count({
    where: { categoryId },
  });
};

const remove = async (id, client = prisma) => {
  return client.cafeCategory.delete({
    where: { id },
  });
};

module.exports = {
  findById,
  findByName,
  findByNameExcludingId,
  listCategories,
  create,
  update,
  countItems,
  remove,
};
