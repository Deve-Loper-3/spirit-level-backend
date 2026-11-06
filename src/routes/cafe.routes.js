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
const {
  validateListOrdersQuery,
  validateOrderSummaryQuery,
  validateOrderIdParam,
  validateOrderDetailQuery,
  validateUpdateOrderStatusBody,
} = require('../validators/cafeOrder.validation');
const {
  listCafeOrders,
  getCafeOrder,
  getCafeOrderSummary,
  patchCafeOrderStatus,
} = require('../controllers/cafeOrder.controller');
const { ORDER_READ_ROLES, ORDER_ADMIN_ROLES } = require('../constants/cafeOrder');

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

// Orders (SLAPP-79/82), read-only. Role gate here; per-order visibility (admins see all, other
// staff see only their own) is enforced in the service. '/orders/summary' precedes '/:orderId'.
router.get(
  '/orders',
  authenticate,
  authorize(...ORDER_READ_ROLES),
  cafeReadLimiter,
  validateListOrdersQuery,
  listCafeOrders,
);

router.all('/orders', methodNotAllowed(['GET']));

router.get(
  '/orders/summary',
  authenticate,
  authorize(...ORDER_READ_ROLES),
  cafeReadLimiter,
  validateOrderSummaryQuery,
  getCafeOrderSummary,
);

router.all('/orders/summary', methodNotAllowed(['GET']));

router.get(
  '/orders/:orderId',
  authenticate,
  authorize(...ORDER_READ_ROLES),
  cafeReadLimiter,
  validateOrderIdParam,
  validateOrderDetailQuery,
  getCafeOrder,
);

router.all('/orders/:orderId', methodNotAllowed(['GET']));

// SLAPP-79/82 phase 2: one-step status change, OWNER/ADMIN only, cafe write limiter.
// The detail query validator is reused so this route also rejects any query parameter.
router.patch(
  '/orders/:orderId/status',
  authenticate,
  authorize(...ORDER_ADMIN_ROLES),
  cafeLimiter,
  validateOrderIdParam,
  validateOrderDetailQuery,
  validateUpdateOrderStatusBody,
  patchCafeOrderStatus,
);

router.all('/orders/:orderId/status', methodNotAllowed(['PATCH']));

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
