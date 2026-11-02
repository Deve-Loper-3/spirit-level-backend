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
