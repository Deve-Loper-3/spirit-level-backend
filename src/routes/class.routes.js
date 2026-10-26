const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { classLimiter, classReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { loadClass } = require('../middlewares/loadClass.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const {
  validateCreateClass,
  validateUpdateClassBody,
  validateClassEligibility,
  validateListClassesQuery,
} = require('../validators/class.validation');
const {
  listClasses,
  getClass,
  createClass,
  updateClass,
  deactivateClass,
  activateClass,
  archiveClass,
  updateEligibility,
} = require('../controllers/class.controller');

const router = Router();

// GET /api/v1/classes - List classes
router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  classReadLimiter,
  validateListClassesQuery,
  listClasses,
);

// POST /api/v1/classes - Create class
router.post(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  validateCreateClass,
  createClass,
);

// POST /api/v1/classes/:id/activate - Activate class
router.post(
  '/:id/activate',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  loadClass(),
  activateClass,
);
router.all('/:id/activate', methodNotAllowed(['POST']));

// POST /api/v1/classes/:id/archive - Archive class
router.post(
  '/:id/archive',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  loadClass(),
  archiveClass,
);
router.all('/:id/archive', methodNotAllowed(['POST']));

// POST /api/v1/classes/:id/deactivate - Deactivate class
router.post(
  '/:id/deactivate',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  loadClass(),
  deactivateClass,
);
router.all('/:id/deactivate', methodNotAllowed(['POST']));

// PUT /api/v1/classes/:id/eligibility - Update eligible plans
router.put(
  '/:id/eligibility',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  loadClass(),
  validateClassEligibility,
  updateEligibility,
);
router.all('/:id/eligibility', methodNotAllowed(['PUT']));

// GET /api/v1/classes/:id - Get class details
router.get(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  classReadLimiter,
  loadClass(),
  getClass,
);

// PATCH /api/v1/classes/:id - Update class
router.patch(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  loadClass(),
  validateUpdateClassBody,
  updateClass,
);
router.all('/:id', methodNotAllowed(['GET', 'PATCH']));

router.all('/', methodNotAllowed(['GET', 'POST']));

module.exports = router;
