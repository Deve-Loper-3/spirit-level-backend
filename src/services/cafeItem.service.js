const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Role } = require('../constants/roles');
const {
  CafeItemAvailability,
  DbCafeItemAvailability,
  DbCafeItemVisibility,
  API_TO_DB_AVAILABILITY,
  API_TO_DB_VISIBILITY,
} = require('../constants/cafe');
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require('../constants/pagination');
const { orNotFound } = require('../utils/prismaError.util');
const { escapeLikePattern } = require('../utils/like.util');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');
const { toCafeItemResponse } = require('../repositories/cafe.mapper');
const { findById: findCategoryById } = require('../repositories/cafeCategory.repository');
const {
  findById,
  listItems: findItems,
  countItems,
  create,
  update,
} = require('../repositories/cafeItem.repository');

const listItems = async ({ query = {}, userRole }) => {
  const { search, categoryId, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = query;

  const where = {};

  if (userRole === Role.MEMBER) {
    where.visibility = DbCafeItemVisibility.PUBLIC;
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (search) {
    const term = escapeLikePattern(search.trim());
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ];
  }

  const { skip, take } = toSkipTake({ page, limit });

  const [items, total] = await Promise.all([
    findItems({ where, skip, take, orderBy: { name: 'asc' } }),
    countItems(where),
  ]);

  return {
    data: items.map(toCafeItemResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getItemById = async ({ itemId, userRole }) => {
  const item = await findById(itemId);
  if (!item) {
    throw createAppError(AppErrors.ITEM_NOT_FOUND);
  }

  if (userRole === Role.MEMBER && item.visibility === DbCafeItemVisibility.STAFF_ONLY) {
    throw createAppError(AppErrors.ITEM_NOT_FOUND);
  }

  return toCafeItemResponse(item);
};

const createItem = async ({ payload }) => {
  const category = await findCategoryById(payload.categoryId);
  if (!category) {
    throw createAppError(AppErrors.CATEGORY_NOT_FOUND_BODY);
  }

  const isTracked = payload.isTracked !== undefined ? Boolean(payload.isTracked) : true;

  let stockQuantity;
  let unitCost;
  let dbAvailability;

  if (isTracked) {
    if (
      payload.stockQuantity === undefined ||
      payload.stockQuantity === null ||
      payload.unitCost === undefined ||
      payload.unitCost === null
    ) {
      throw createAppError(AppErrors.ITEM_TRACKED_STOCK_REQUIRED);
    }

    stockQuantity = Number(payload.stockQuantity);
    unitCost = payload.unitCost;

    if (stockQuantity === 0) {
      if (payload.availability === CafeItemAvailability.AVAILABLE) {
        throw createAppError(AppErrors.ITEM_SOLD_OUT_ZERO_STOCK);
      }
      dbAvailability = DbCafeItemAvailability.SOLD_OUT;
    } else {
      dbAvailability = payload.availability
        ? API_TO_DB_AVAILABILITY[payload.availability]
        : DbCafeItemAvailability.AVAILABLE;
    }
  } else {
    // Untracked items (coffee/shakes, made to order): no stock.
    // Silently set stockQuantity and unitCost to null.
    stockQuantity = null;
    unitCost = null;
    dbAvailability = payload.availability
      ? API_TO_DB_AVAILABILITY[payload.availability]
      : DbCafeItemAvailability.AVAILABLE;
  }

  const dbVisibility = payload.visibility
    ? API_TO_DB_VISIBILITY[payload.visibility]
    : DbCafeItemVisibility.PUBLIC;

  const created = await create({
    name: payload.name.trim(),
    categoryId: payload.categoryId,
    description: payload.description ? payload.description.trim() : null,
    nutrition: payload.nutrition ?? undefined,
    priceAed: payload.priceAed,
    imageUrl: payload.imageUrl ?? null,
    availability: dbAvailability,
    visibility: dbVisibility,
    isTracked,
    stockQuantity,
    unitCost,
  });

  return toCafeItemResponse(created);
};

const updateItem = async ({ itemId, payload }) => {
  const existing = await findById(itemId);
  if (!existing) {
    throw createAppError(AppErrors.ITEM_NOT_FOUND);
  }

  if (payload.categoryId !== undefined) {
    const category = await findCategoryById(payload.categoryId);
    if (!category) {
      throw createAppError(AppErrors.CATEGORY_NOT_FOUND_BODY);
    }
  }

  const effectiveIsTracked =
    payload.isTracked !== undefined ? Boolean(payload.isTracked) : existing.isTracked;

  // Switching isTracked false -> true without stockQuantity and unitCost returns 400.
  if (!existing.isTracked && effectiveIsTracked) {
    if (
      payload.stockQuantity === undefined ||
      payload.stockQuantity === null ||
      payload.unitCost === undefined ||
      payload.unitCost === null
    ) {
      throw createAppError(AppErrors.ITEM_TRACKED_STOCK_REQUIRED);
    }
  }

  const dataToUpdate = {};

  if (effectiveIsTracked) {
    let effectiveStock;
    if (payload.stockQuantity !== undefined) {
      if (payload.stockQuantity === null) {
        throw createAppError(AppErrors.ITEM_TRACKED_STOCK_REQUIRED);
      }
      effectiveStock = Number(payload.stockQuantity);
    } else {
      effectiveStock = existing.stockQuantity;
    }

    let effectiveUnitCost;
    if (payload.unitCost !== undefined) {
      if (payload.unitCost === null) {
        throw createAppError(AppErrors.ITEM_TRACKED_STOCK_REQUIRED);
      }
      effectiveUnitCost = payload.unitCost;
    } else {
      effectiveUnitCost = existing.unitCost;
    }

    dataToUpdate.isTracked = true;
    dataToUpdate.stockQuantity = effectiveStock;
    dataToUpdate.unitCost = effectiveUnitCost;

    // Auto-set sold_out when tracked stock reaches 0
    if (effectiveStock === 0) {
      dataToUpdate.availability = DbCafeItemAvailability.SOLD_OUT;
    }
    // No automatic AVAILABLE on restock. It stays existing.availability.
  } else {
    // Untracked items: no stock. Silently set both to null.
    dataToUpdate.isTracked = false;
    dataToUpdate.stockQuantity = null;
    dataToUpdate.unitCost = null;
  }

  if (payload.name !== undefined) {
    dataToUpdate.name = payload.name.trim();
  }
  if (payload.categoryId !== undefined) {
    dataToUpdate.categoryId = payload.categoryId;
  }
  if (payload.description !== undefined) {
    dataToUpdate.description = payload.description ? payload.description.trim() : null;
  }
  if (payload.nutrition !== undefined) {
    dataToUpdate.nutrition = payload.nutrition ?? null;
  }
  if (payload.priceAed !== undefined) {
    dataToUpdate.priceAed = payload.priceAed;
  }
  if (payload.imageUrl !== undefined) {
    dataToUpdate.imageUrl = payload.imageUrl ?? null;
  }

  const updated = await orNotFound(() => update(itemId, dataToUpdate), AppErrors.ITEM_NOT_FOUND);
  return toCafeItemResponse(updated);
};

const updateItemAvailability = async ({ itemId, payload }) => {
  const existing = await findById(itemId);
  if (!existing) {
    throw createAppError(AppErrors.ITEM_NOT_FOUND);
  }

  // Setting AVAILABLE while stock is 0 returns 400.
  if (
    existing.isTracked &&
    existing.stockQuantity === 0 &&
    payload.availability === CafeItemAvailability.AVAILABLE
  ) {
    throw createAppError(AppErrors.ITEM_SOLD_OUT_ZERO_STOCK);
  }

  const dbAvailability = API_TO_DB_AVAILABILITY[payload.availability];
  const updated = await orNotFound(
    () => update(itemId, { availability: dbAvailability }),
    AppErrors.ITEM_NOT_FOUND,
  );
  return toCafeItemResponse(updated);
};

const updateItemVisibility = async ({ itemId, payload }) => {
  const existing = await findById(itemId);
  if (!existing) {
    throw createAppError(AppErrors.ITEM_NOT_FOUND);
  }

  const dbVisibility = API_TO_DB_VISIBILITY[payload.visibility];
  const updated = await orNotFound(
    () => update(itemId, { visibility: dbVisibility }),
    AppErrors.ITEM_NOT_FOUND,
  );
  return toCafeItemResponse(updated);
};

module.exports = {
  listItems,
  getItemById,
  createItem,
  updateItem,
  updateItemAvailability,
  updateItemVisibility,
};
