const { DB_TO_API_AVAILABILITY, DB_TO_API_VISIBILITY } = require('../constants/cafe');

const decimalToNumber = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  const num = Number(val);
  return Number.isFinite(num) ? num : val;
};

const toCafeItemResponse = (item) => {
  if (!item) return null;

  const availability =
    DB_TO_API_AVAILABILITY[item.availability] ||
    (typeof item.availability === 'string' ? item.availability.toLowerCase() : item.availability);

  const visibility =
    DB_TO_API_VISIBILITY[item.visibility] ||
    (typeof item.visibility === 'string' ? item.visibility.toLowerCase() : item.visibility);

  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    category: item.category
      ? {
          id: item.category.id,
          name: item.category.name,
          description: item.category.description ?? null,
        }
      : undefined,
    description: item.description ?? null,
    nutrition: item.nutrition ?? null,
    priceAed: decimalToNumber(item.priceAed),
    imageUrl: item.imageUrl ?? null,
    availability,
    visibility,
    isTracked: Boolean(item.isTracked),
    stockQuantity: item.stockQuantity ?? null,
    unitCost: decimalToNumber(item.unitCost),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const toCafeInventoryItemResponse = (item, stockStatus) => {
  if (!item) return null;

  const unitCost = decimalToNumber(item.unitCost);

  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    category: item.category ? { id: item.category.id, name: item.category.name } : undefined,
    quantity: item.stockQuantity ?? null,
    unitCost: unitCost === 0 ? null : unitCost,
    stockStatus,
  };
};

const toCafeStockUpdateResponse = (item, stockStatus) => {
  if (!item) return null;

  return {
    ...toCafeInventoryItemResponse(item, stockStatus),
    availability: DB_TO_API_AVAILABILITY[item.availability],
    updatedAt: item.updatedAt,
  };
};

module.exports = {
  decimalToNumber,
  toCafeItemResponse,
  toCafeInventoryItemResponse,
  toCafeStockUpdateResponse,
};
