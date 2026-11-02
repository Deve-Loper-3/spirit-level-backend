const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Role } = require('../constants/roles');
const { isUniqueConstraintError } = require('../utils/prismaError.util');
const {
  findById,
  findByName,
  findByNameExcludingId,
  listCategories: listAllCategories,
  create,
  update,
  countItems,
  remove,
} = require('../repositories/cafeCategory.repository');

const listCategories = async ({ userRole }) => {
  const countPublicOnly = userRole === Role.MEMBER;
  const categories = await listAllCategories({ countPublicOnly });

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    description: cat.description ?? null,
    itemCount: cat._count?.items ?? 0,
    createdAt: cat.createdAt,
    updatedAt: cat.updatedAt,
  }));
};

const createCategory = async ({ payload }) => {
  const trimmedName = (payload.name || '').trim();

  const existing = await findByName(trimmedName);
  if (existing) {
    throw createAppError(AppErrors.CATEGORY_EXISTS);
  }

  try {
    const created = await create({
      name: trimmedName,
      description: payload.description,
    });

    return {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      itemCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw createAppError(AppErrors.CATEGORY_EXISTS);
    }
    throw err;
  }
};

const updateCategory = async ({ categoryId, payload }) => {
  const existing = await findById(categoryId);
  if (!existing) {
    throw createAppError(AppErrors.CATEGORY_NOT_FOUND);
  }

  if (payload.name) {
    const duplicate = await findByNameExcludingId(payload.name, categoryId);
    if (duplicate) {
      throw createAppError(AppErrors.CATEGORY_EXISTS);
    }
  }

  try {
    const updated = await update(categoryId, payload);
    const count = await countItems(categoryId);

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description ?? null,
      itemCount: count,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw createAppError(AppErrors.CATEGORY_EXISTS);
    }
    throw err;
  }
};

const deleteCategory = async ({ categoryId }) => {
  const existing = await findById(categoryId);
  if (!existing) {
    throw createAppError(AppErrors.CATEGORY_NOT_FOUND);
  }

  const count = await countItems(categoryId);
  if (count > 0) {
    throw createAppError(AppErrors.CATEGORY_HAS_ITEMS);
  }

  await remove(categoryId);
  return null;
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
