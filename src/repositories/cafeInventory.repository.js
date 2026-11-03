const prisma = require('../config/prisma');
const { countItems, update } = require('./cafeItem.repository');
const { escapeLikePattern } = require('../utils/like.util');

const buildInventoryWhere = ({ categoryId, search } = {}) => {
  const where = { isTracked: true };

  if (categoryId) where.categoryId = categoryId;

  const term = search?.trim();
  if (term) {
    const escaped = escapeLikePattern(term);
    where.OR = [
      { name: { contains: escaped, mode: 'insensitive' } },
      { description: { contains: escaped, mode: 'insensitive' } },
    ];
  }

  return where;
};

const listTrackedItems = async ({ categoryId, search, skip = 0, take } = {}, client = prisma) =>
  client.cafeItem.findMany({
    where: buildInventoryWhere({ categoryId, search }),
    skip,
    take,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { id: true, name: true } },
      stockQuantity: true,
      unitCost: true,
    },
  });

const countTrackedItems = async (filters = {}, client = prisma) =>
  countItems(buildInventoryWhere(filters), client);

const getSummaryItems = async (client = prisma) =>
  client.cafeItem.findMany({
    where: { isTracked: true },
    select: { stockQuantity: true, unitCost: true },
  });

module.exports = {
  listTrackedItems,
  countTrackedItems,
  getSummaryItems,
  updateStock: update,
};
