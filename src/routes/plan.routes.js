const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { planLimiter, planReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { Role } = require('../constants/roles');
const {
  validateCreatePlan,
  validateListPlansQuery,
} = require('../validators/membershipPlan.validation');
const { createPlan, listPlans } = require('../controllers/plan.controller');

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

module.exports = router;
