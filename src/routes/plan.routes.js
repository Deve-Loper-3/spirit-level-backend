const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { planLimiter } = require('../middlewares/rateLimiter.middleware');
const { Role } = require('../constants/roles');
const { validateCreatePlan } = require('../validators/membershipPlan.validation');
const { createPlan } = require('../controllers/plan.controller');

const router = Router();

router.post(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  planLimiter,
  validateCreatePlan,
  createPlan,
);

module.exports = router;
