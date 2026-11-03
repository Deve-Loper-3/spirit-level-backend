const z = require('zod');
const { Messages } = require('../constants/messages');
const {
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  ITEM_NAME_MIN_LENGTH,
  ITEM_NAME_MAX_LENGTH,
  ITEM_DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  ITEM_PRICE_MIN,
  ITEM_PRICE_MAX,
  ITEM_STOCK_MIN,
  ITEM_STOCK_MAX,
  CafeItemAvailability,
  CafeItemVisibility,
  CafeStockStatus,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../constants/cafe');
const { pageField, buildSizeField } = require('./pagination.validation');
const { ALLOWED_IMAGE_MIME_TYPES } = require('../constants/upload');
const { sendValidationFailed } = require('../utils/validationError.util');

const httpsUrlSchema = z
  .string()
  .url(Messages.ITEM_IMAGE_URL_INVALID)
  .refine((val) => val.startsWith('https://'), {
    message: Messages.ITEM_IMAGE_URL_INVALID,
  });

const categoryIdParamSchema = z.object({
  categoryId: z.string().uuid({ message: Messages.ITEM_CATEGORY_INVALID }),
});

const itemIdParamSchema = z.object({
  itemId: z.string().uuid({ message: Messages.ITEM_CATEGORY_INVALID }),
});

const createCategorySchema = z.object({
  name: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z
      .string({ error: Messages.CATEGORY_NAME_REQUIRED })
      .min(CATEGORY_NAME_MIN_LENGTH, Messages.CATEGORY_NAME_REQUIRED)
      .max(CATEGORY_NAME_MAX_LENGTH, Messages.CATEGORY_NAME_INVALID),
  ),
  description: z.preprocess((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? null : trimmed;
    }
    return val;
  }, z.string().max(CATEGORY_DESCRIPTION_MAX_LENGTH, Messages.CATEGORY_DESCRIPTION_MAX).nullable().optional()),
});

const updateCategorySchema = z
  .object({
    name: z.preprocess(
      (val) => (typeof val === 'string' ? val.trim() : val),
      z
        .string()
        .min(CATEGORY_NAME_MIN_LENGTH, Messages.CATEGORY_NAME_REQUIRED)
        .max(CATEGORY_NAME_MAX_LENGTH, Messages.CATEGORY_NAME_INVALID)
        .optional(),
    ),
    description: z.preprocess((val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? null : trimmed;
      }
      return val;
    }, z.string().max(CATEGORY_DESCRIPTION_MAX_LENGTH, Messages.CATEGORY_DESCRIPTION_MAX).nullable().optional()),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: Messages.CATEGORY_UPDATE_EMPTY,
  });

const listItemsQuerySchema = z.object({
  search: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z.string().max(SEARCH_MAX_LENGTH, Messages.ITEM_SEARCH_MAX).optional(),
  ),
  categoryId: z.string().uuid({ message: Messages.ITEM_CATEGORY_INVALID }).optional(),
  page: pageField.default(DEFAULT_PAGE),
  limit: buildSizeField({
    message: 'Limit must be a positive integer',
    max: MAX_LIMIT,
    defaultValue: DEFAULT_LIMIT,
  }),
});

const listInventoryQuerySchema = listItemsQuerySchema.extend({
  status: z
    .enum(Object.values(CafeStockStatus), { error: Messages.ITEM_STOCK_STATUS_INVALID })
    .optional(),
});

const updateItemStockSchema = z.object({
  quantity: z
    .number({ error: Messages.ITEM_STOCK_INVALID })
    .int(Messages.ITEM_STOCK_INVALID)
    .min(ITEM_STOCK_MIN, Messages.ITEM_STOCK_INVALID),
});

const createItemSchema = z.object({
  name: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z
      .string({ error: Messages.ITEM_NAME_REQUIRED })
      .min(ITEM_NAME_MIN_LENGTH, Messages.ITEM_NAME_REQUIRED)
      .max(ITEM_NAME_MAX_LENGTH, Messages.ITEM_NAME_INVALID),
  ),
  categoryId: z.string({ error: Messages.ITEM_CATEGORY_REQUIRED }).uuid({
    message: Messages.ITEM_CATEGORY_INVALID,
  }),
  description: z.preprocess((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? null : trimmed;
    }
    return val;
  }, z.string().max(ITEM_DESCRIPTION_MAX_LENGTH, Messages.ITEM_DESCRIPTION_MAX).nullable().optional()),
  nutrition: z.record(z.string(), z.any()).nullable().optional(),
  priceAed: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '') return undefined;
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : val;
      }
      return val;
    },
    z
      .number({ error: Messages.ITEM_PRICE_REQUIRED })
      .min(ITEM_PRICE_MIN, Messages.ITEM_PRICE_INVALID)
      .max(ITEM_PRICE_MAX, Messages.ITEM_PRICE_INVALID),
  ),
  imageUrl: z.preprocess((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? null : trimmed;
    }
    return val;
  }, httpsUrlSchema.nullable().optional()),
  visibility: z
    .enum([CafeItemVisibility.PUBLIC, CafeItemVisibility.STAFF_ONLY], {
      error: Messages.ITEM_VISIBILITY_INVALID,
    })
    .optional()
    .default(CafeItemVisibility.PUBLIC),
  isTracked: z.boolean().optional().default(true),
  stockQuantity: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const num = Number(val);
      return Number.isFinite(num) ? num : val;
    }
    return val;
  }, z.number().int(Messages.ITEM_STOCK_INVALID).min(ITEM_STOCK_MIN, Messages.ITEM_STOCK_INVALID).max(ITEM_STOCK_MAX, Messages.ITEM_STOCK_INVALID).nullable().optional()),
  unitCost: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const num = Number(val);
      return Number.isFinite(num) ? num : val;
    }
    return val;
  }, z.number().min(0, Messages.ITEM_UNIT_COST_INVALID).max(ITEM_PRICE_MAX, Messages.ITEM_UNIT_COST_INVALID).nullable().optional()),
  availability: z
    .enum([CafeItemAvailability.AVAILABLE, CafeItemAvailability.SOLD_OUT], {
      error: Messages.ITEM_AVAILABILITY_INVALID,
    })
    .optional(),
});

const updateItemSchema = z
  .object({
    name: z.preprocess(
      (val) => (typeof val === 'string' ? val.trim() : val),
      z
        .string()
        .min(ITEM_NAME_MIN_LENGTH, Messages.ITEM_NAME_REQUIRED)
        .max(ITEM_NAME_MAX_LENGTH, Messages.ITEM_NAME_INVALID)
        .optional(),
    ),
    categoryId: z.string().uuid({ message: Messages.ITEM_CATEGORY_INVALID }).optional(),
    description: z.preprocess((val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? null : trimmed;
      }
      return val;
    }, z.string().max(ITEM_DESCRIPTION_MAX_LENGTH, Messages.ITEM_DESCRIPTION_MAX).nullable().optional()),
    nutrition: z.record(z.string(), z.any()).nullable().optional(),
    priceAed: z.preprocess((val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '') return undefined;
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : val;
      }
      return val;
    }, z.number().min(ITEM_PRICE_MIN, Messages.ITEM_PRICE_INVALID).max(ITEM_PRICE_MAX, Messages.ITEM_PRICE_INVALID).optional()),
    imageUrl: z.preprocess((val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? null : trimmed;
      }
      return val;
    }, httpsUrlSchema.nullable().optional()),
    isTracked: z.boolean().optional(),
    stockQuantity: z.preprocess((val) => {
      if (val === '' || val === null || val === undefined) return null;
      if (typeof val === 'string') {
        const num = Number(val);
        return Number.isFinite(num) ? num : val;
      }
      return val;
    }, z.number().int(Messages.ITEM_STOCK_INVALID).min(ITEM_STOCK_MIN, Messages.ITEM_STOCK_INVALID).max(ITEM_STOCK_MAX, Messages.ITEM_STOCK_INVALID).nullable().optional()),
    unitCost: z.preprocess((val) => {
      if (val === '' || val === null || val === undefined) return null;
      if (typeof val === 'string') {
        const num = Number(val);
        return Number.isFinite(num) ? num : val;
      }
      return val;
    }, z.number().min(0, Messages.ITEM_UNIT_COST_INVALID).max(ITEM_PRICE_MAX, Messages.ITEM_UNIT_COST_INVALID).nullable().optional()),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: Messages.ITEM_UPDATE_EMPTY,
  });

const updateItemAvailabilitySchema = z.object({
  availability: z.enum([CafeItemAvailability.AVAILABLE, CafeItemAvailability.SOLD_OUT], {
    error: Messages.ITEM_AVAILABILITY_INVALID,
  }),
});

const updateItemVisibilitySchema = z.object({
  visibility: z.enum([CafeItemVisibility.PUBLIC, CafeItemVisibility.STAFF_ONLY], {
    error: Messages.ITEM_VISIBILITY_INVALID,
  }),
});

const validateCategoryIdParam = (req, res, next) => {
  const result = categoryIdParamSchema.safeParse(req.params ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.params = result.data;
  return next();
};

const validateItemIdParam = (req, res, next) => {
  const result = itemIdParamSchema.safeParse(req.params ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.params = result.data;
  return next();
};

const validateCreateCategory = (req, res, next) => {
  const result = createCategorySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateUpdateCategory = (req, res, next) => {
  const result = updateCategorySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateListItemsQuery = (req, res, next) => {
  const result = listItemsQuerySchema.safeParse(req.query ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

const validateListInventoryQuery = (req, res, next) => {
  const result = listInventoryQuerySchema.safeParse(req.query ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

const validateUpdateItemStock = (req, res, next) => {
  const result = updateItemStockSchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateCreateItem = (req, res, next) => {
  const result = createItemSchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateUpdateItem = (req, res, next) => {
  const body = req.body ?? {};
  if (body.availability !== undefined) {
    return sendValidationFailed(res, {
      issues: [
        {
          path: ['availability'],
          message: Messages.ITEM_FIELD_NOT_EDITABLE_HERE,
        },
      ],
    });
  }
  if (body.visibility !== undefined) {
    return sendValidationFailed(res, {
      issues: [
        {
          path: ['visibility'],
          message: Messages.ITEM_FIELD_NOT_EDITABLE_HERE,
        },
      ],
    });
  }

  const result = updateItemSchema.safeParse(body);
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateUpdateItemAvailability = (req, res, next) => {
  const result = updateItemAvailabilitySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateUpdateItemVisibility = (req, res, next) => {
  const result = updateItemVisibilitySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const cafeImageTokenSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_MIME_TYPES, {
    error: Messages.IMAGE_TYPE_NOT_ALLOWED,
  }),
});

const validateCafeImageToken = (req, res, next) => {
  const result = cafeImageTokenSchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

module.exports = {
  categoryIdParamSchema,
  itemIdParamSchema,
  createCategorySchema,
  updateCategorySchema,
  listItemsQuerySchema,
  listInventoryQuerySchema,
  updateItemStockSchema,
  createItemSchema,
  updateItemSchema,
  updateItemAvailabilitySchema,
  updateItemVisibilitySchema,
  cafeImageTokenSchema,
  validateCategoryIdParam,
  validateItemIdParam,
  validateCreateCategory,
  validateUpdateCategory,
  validateListItemsQuery,
  validateListInventoryQuery,
  validateUpdateItemStock,
  validateCreateItem,
  validateUpdateItem,
  validateUpdateItemAvailability,
  validateUpdateItemVisibility,
  validateCafeImageToken,
};
