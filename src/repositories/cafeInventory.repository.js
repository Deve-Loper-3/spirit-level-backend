const prisma = require('../config/prisma');
const { CafeStockStatus, LOW_STOCK_THRESHOLD } = require('../constants/cafe');
const { countItems, update, findById } = require('./cafeItem.repository');
const { escapeLikePattern } = require('../utils/like.util');

const stockStatusWhere = (status) => {
  if (status === CafeStockStatus.OUT_OF_STOCK) return { stockQuantity: 0 };
  if (status === CafeStockStatus.LOW_STOCK) {
    return { stockQuantity: { gt: 0, lt: LOW_STOCK_THRESHOLD } };
  }
  if (status === CafeStockStatus.IN_STOCK) {
    return { stockQuantity: { gte: LOW_STOCK_THRESHOLD } };
  }
  return {};
};

const buildInventoryWhere = ({ categoryId, search, status } = {}) => {
  const where = { isTracked: true, ...stockStatusWhere(status) };

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

const inventorySelect = Object.freeze({
  id: true,
  name: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  stockQuantity: true,
  unitCost: true,
  availability: true,
});

const listTrackedItems = async (
  { categoryId, search, status, skip = 0, take } = {},
  client = prisma,
) =>
  client.cafeItem.findMany({
    where: buildInventoryWhere({ categoryId, search, status }),
    skip,
    take,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: inventorySelect,
  });

const countTrackedItems = async (filters = {}, client = prisma) =>
  countItems(buildInventoryWhere(filters), client);

const getSummaryItems = async (client = prisma) =>
  client.cafeItem.findMany({
    where: { isTracked: true },
    select: { stockQuantity: true, unitCost: true },
  });

/**
 * Atomically decrease stock when quantity is available.
 * Returns the updated item, or null when the item is missing / untracked / insufficient stock.
 * Sets SOLD_OUT when the resulting quantity is 0.
 */
const decrementStockIfAvailable = async (
  { itemId, quantity, soldOutAvailability },
  client = prisma,
) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('decrementStockIfAvailable: quantity must be a positive integer');
  }

  const { count } = await client.cafeItem.updateMany({
    where: {
      id: itemId,
      isTracked: true,
      stockQuantity: { gte: quantity },
    },
    data: {
      stockQuantity: { decrement: quantity },
    },
  });
  if (count === 0) return null;

  const updated = await findById(itemId, client);
  if (updated?.stockQuantity === 0 && soldOutAvailability) {
    return client.cafeItem.update({
      where: { id: itemId },
      data: { availability: soldOutAvailability },
      include: { category: true },
    });
  }
  return updated;
};

module.exports = {
  buildInventoryWhere,
  stockStatusWhere,
  listTrackedItems,
  countTrackedItems,
  getSummaryItems,
  updateStock: update,
  decrementStockIfAvailable,
};
