const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { planLimiter, planReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const { validateCreateMembership } = require('../validators/membership.validation');
const {
  createMembership,
  listMemberships,
} = require('../controllers/membership.controller');

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  planReadLimiter,
  listMemberships,
);

router.post(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  planLimiter,
  validateCreateMembership,
  createMembership,
);

router.all('/', methodNotAllowed(['GET', 'POST']));

module.exports = router;
