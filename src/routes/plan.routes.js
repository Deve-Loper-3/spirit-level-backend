const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { planLimiter, planReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { loadPlan } = require('../middlewares/loadPlan.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const { validatePlanIdParam } = require('../validators/idParam.validation');
const {
  validateCreatePlan,
  validateListPlansQuery,
  validateUpdatePlanBody,
  validatePlanStatusBody,
} = require('../validators/membershipPlan.validation');
const {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  changePlanStatus,
} = require('../controllers/plan.controller');

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  planReadLimiter,
  validateListPlansQuery,
  listPlans,
);

router.post(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  planLimiter,
  validateCreatePlan,
  createPlan,
);

router.get(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  planReadLimiter,
  validatePlanIdParam,
  loadPlan(),
  getPlan,
);

router.patch(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  planLimiter,
  validatePlanIdParam,
  loadPlan({ rejectArchived: true }),
  validateUpdatePlanBody,
  updatePlan,
);

router.patch(
  '/:id/status',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  planLimiter,
  validatePlanIdParam,
  loadPlan(),
  validatePlanStatusBody,
  changePlanStatus,
);

// Plans are never deleted (they are archived), so DELETE and every other method is a 405.
router.all('/:id', methodNotAllowed(['GET', 'PATCH']));
router.all('/:id/status', methodNotAllowed(['PATCH']));

module.exports = router;
