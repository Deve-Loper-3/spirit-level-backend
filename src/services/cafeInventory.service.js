const { Prisma } = require('@prisma/client');
const {
  CafeStockStatus,
  LOW_STOCK_THRESHOLD,
  DbCafeItemAvailability,
} = require('../constants/cafe');
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require('../constants/pagination');
const { AppErrors } = require('../constants/errors');
const { createAppError } = require('../errors/AppError');
const { findById } = require('../repositories/cafeItem.repository');
const {
  listTrackedItems,
  countTrackedItems,
  getSummaryItems,
  updateStock: persistStock,
  decrementStockIfAvailable,
} = require('../repositories/cafeInventory.repository');
const {
  decimalToNumber,
  toCafeInventoryItemResponse,
  toCafeStockUpdateResponse,
} = require('../repositories/cafe.mapper');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');
const { orNotFound } = require('../utils/prismaError.util');

const MINOR_UNITS_PER_AED = 100;

const deriveStockStatus = (quantity) => {
  if (quantity === 0) return CafeStockStatus.OUT_OF_STOCK;
  if (quantity < LOW_STOCK_THRESHOLD) return CafeStockStatus.LOW_STOCK;
  return CafeStockStatus.IN_STOCK;
};

const updateStock = async ({ itemId, payload }) => {
  const existing = await findById(itemId);
  if (!existing) throw createAppError(AppErrors.ITEM_NOT_FOUND);
  if (!existing.isTracked) throw createAppError(AppErrors.ITEM_NOT_TRACKED);

  const data = { stockQuantity: payload.quantity };
  if (payload.quantity === 0) data.availability = DbCafeItemAvailability.SOLD_OUT;
  // Restock does not auto-flip to AVAILABLE (staff must set availability explicitly).

  // One write persists quantity and its zero-stock availability side effect together.
  const updated = await orNotFound(() => persistStock(itemId, data), AppErrors.ITEM_NOT_FOUND);

  return toCafeStockUpdateResponse(updated, deriveStockStatus(updated.stockQuantity));
};

/**
 * Safe stock deduction for future order creation. Fails closed on races / insufficient stock.
 */
const consumeStock = async ({ itemId, quantity }) => {
  const existing = await findById(itemId);
  if (!existing) throw createAppError(AppErrors.ITEM_NOT_FOUND);
  if (!existing.isTracked) throw createAppError(AppErrors.ITEM_NOT_TRACKED);

  const updated = await decrementStockIfAvailable({
    itemId,
    quantity,
    soldOutAvailability: DbCafeItemAvailability.SOLD_OUT,
  });
  if (!updated) throw createAppError(AppErrors.ITEM_INSUFFICIENT_STOCK);

  return toCafeStockUpdateResponse(updated, deriveStockStatus(updated.stockQuantity));
};

const listInventory = async ({ query = {} } = {}) => {
  const { categoryId, search, status, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = query;
  const filters = { categoryId, search, status };
  const { skip, take } = toSkipTake({ page, limit });

  const [items, total] = await Promise.all([
    listTrackedItems({ ...filters, skip, take }),
    countTrackedItems(filters),
  ]);

  return {
    data: items.map((item) =>
      toCafeInventoryItemResponse(item, deriveStockStatus(item.stockQuantity)),
    ),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getSummary = async () => {
  const items = await getSummaryItems();
  let lowStock = 0;
  let outOfStock = 0;
  let itemsMissingCost = 0;
  let stockValueMinor = 0n;

  for (const item of items) {
    if (item.stockQuantity < LOW_STOCK_THRESHOLD) lowStock += 1;
    if (item.stockQuantity === 0) outOfStock += 1;

    // Persisted unitCost has scale 2. Convert exactly to integer fils before accumulating.
    // unitCost 0 is treated as a missing/placeholder cost (excluded from stock value).
    const costMinor = BigInt(new Prisma.Decimal(item.unitCost).mul(MINOR_UNITS_PER_AED).toFixed(0));
    if (costMinor === 0n) itemsMissingCost += 1;
    if (costMinor > 0n) stockValueMinor += BigInt(item.stockQuantity) * costMinor;
  }

  return {
    trackedItems: items.length,
    lowStock,
    outOfStock,
    stockValueAed: decimalToNumber(
      new Prisma.Decimal(stockValueMinor.toString()).div(MINOR_UNITS_PER_AED),
    ),
    itemsMissingCost,
    itemsSold: null,
    revenueFromItemsAed: null,
    bestSeller: null,
    salesDataAvailable: false,
  };
};

module.exports = {
  deriveStockStatus,
  updateStock,
  consumeStock,
  listInventory,
  getSummary,
};
