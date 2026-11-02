const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

const deleteTestCafeItems = async (prefix, client = prisma) => {
  return client.cafeItem.deleteMany({
    where: {
      name: {
        startsWith: prefix,
        mode: 'insensitive',
      },
    },
  });
};

const deleteTestCafeCategories = async (prefix, client = prisma) => {
  return client.cafeCategory.deleteMany({
    where: {
      name: {
        startsWith: prefix,
        mode: 'insensitive',
      },
    },
  });
};

const createTestCafeCategory = async (prefix, overrides = {}, client = prisma) => {
  return client.cafeCategory.create({
    data: {
      id: crypto.randomUUID(),
      name: `${prefix}${crypto.randomUUID()}`,
      description: 'Test category description',
      ...overrides,
    },
  });
};

const createTestCafeItem = async (prefix, overrides = {}, client = prisma) => {
  return client.cafeItem.create({
    data: {
      id: crypto.randomUUID(),
      name: `${prefix}${crypto.randomUUID()}`,
      categoryId: overrides.categoryId,
      description: 'Test item description',
      priceAed: 25.0,
      imageUrl: null,
      availability: 'AVAILABLE',
      visibility: 'PUBLIC',
      isTracked: true,
      stockQuantity: 10,
      unitCost: 15.0,
      ...overrides,
    },
  });
};

module.exports = {
  deleteTestCafeItems,
  deleteTestCafeCategories,
  createTestCafeCategory,
  createTestCafeItem,
};
