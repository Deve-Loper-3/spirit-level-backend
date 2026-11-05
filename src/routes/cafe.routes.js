const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { cafeLimiter, cafeReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const {
  validateCreateCategory,
  validateUpdateCategory,
  validateCategoryIdParam,
  validateListItemsQuery,
  validateCreateItem,
  validateUpdateItem,
  validateUpdateItemAvailability,
  validateUpdateItemVisibility,
  validateCafeImageToken,
  validateItemIdParam,
  validateUpdateItemStock,
  validateListInventoryQuery,
} = require('../validators/cafe.validation');
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/cafeCategory.controller');
const {
  listItems,
  getItem,
  createItem,
  patchItem,
  patchItemAvailability,
  patchItemVisibility,
  issueCafeImageToken,
} = require('../controllers/cafeItem.controller');
const {
  listInventory,
  getInventorySummary,
  patchItemStock,
} = require('../controllers/cafeInventory.controller');

const router = Router();

// Categories
router.get(
  '/categories',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  cafeReadLimiter,
  listCategories,
);

router.post(
  '/categories',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateCreateCategory,
  createCategory,
);

router.all('/categories', methodNotAllowed(['GET', 'POST']));

router.patch(
  '/categories/:categoryId',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateCategoryIdParam,
  validateUpdateCategory,
  updateCategory,
);

router.delete(
  '/categories/:categoryId',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateCategoryIdParam,
  deleteCategory,
);

router.all('/categories/:categoryId', methodNotAllowed(['PATCH', 'DELETE']));

// Items
router.get(
  '/items',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  cafeReadLimiter,
  validateListItemsQuery,
  listItems,
);

router.post(
  '/items',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateCreateItem,
  createItem,
);

router.all('/items', methodNotAllowed(['GET', 'POST']));

// Inventory stock (SLAPP-79/81): registered before /items/:itemId.
router.patch(
  '/items/:itemId/stock',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateItemIdParam,
  validateUpdateItemStock,
  patchItemStock,
);

router.all('/items/:itemId/stock', methodNotAllowed(['PATCH']));

router.get(
  '/items/:itemId',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  cafeReadLimiter,
  validateItemIdParam,
  getItem,
);

router.patch(
  '/items/:itemId',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateItemIdParam,
  validateUpdateItem,
  patchItem,
);

router.all('/items/:itemId', methodNotAllowed(['GET', 'PATCH']));

router.patch(
  '/items/:itemId/availability',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateItemIdParam,
  validateUpdateItemAvailability,
  patchItemAvailability,
);

router.all('/items/:itemId/availability', methodNotAllowed(['PATCH']));

router.patch(
  '/items/:itemId/visibility',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateItemIdParam,
  validateUpdateItemVisibility,
  patchItemVisibility,
);

router.all('/items/:itemId/visibility', methodNotAllowed(['PATCH']));

// Inventory (SLAPP-79/81). Express matches paths exactly, so '/inventory' and
// '/inventory/summary' (and their 405 handlers) do not conflict.
router.get(
  '/inventory',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeReadLimiter,
  validateListInventoryQuery,
  listInventory,
);

router.all('/inventory', methodNotAllowed(['GET']));

router.get(
  '/inventory/summary',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeReadLimiter,
  getInventorySummary,
);

router.all('/inventory/summary', methodNotAllowed(['GET']));

// Uploads
router.post(
  '/uploads/image/token',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  cafeLimiter,
  validateCafeImageToken,
  issueCafeImageToken,
);

router.all('/uploads/image/token', methodNotAllowed(['POST']));

module.exports = router;
