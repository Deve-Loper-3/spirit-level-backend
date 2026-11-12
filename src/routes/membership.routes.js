const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { planLimiter, planReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const {
  validateCreateMembership,
  validateListMembershipsQuery,
} = require('../validators/membership.validation');
const { validateMembershipIdParam } = require('../validators/idParam.validation');
const {
  createMembership,
  listMemberships,
  getMembership,
} = require('../controllers/membership.controller');

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  planReadLimiter,
  validateListMembershipsQuery,
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

router.get(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  planReadLimiter,
  validateMembershipIdParam,
  getMembership,
);

router.all('/', methodNotAllowed(['GET', 'POST']));
// Memberships are not edited or deleted yet, so every method but GET is a 405.
router.all('/:id', methodNotAllowed(['GET']));

module.exports = router;
