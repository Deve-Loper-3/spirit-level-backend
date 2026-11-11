const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { settingsLimiter, settingsReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const {
  validateBookingRuleIdParam,
  validateCreateBookingRule,
  validateUpdateBookingRule,
} = require('../validators/bookingRule.validation');
const {
  listBookingRules,
  createBookingRule,
  updateBookingRule,
  deleteBookingRule,
} = require('../controllers/bookingRule.controller');

const router = Router();

// Owner and Admin can read the rules; only the Owner can change them.
router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  settingsReadLimiter,
  listBookingRules,
);

router.post(
  '/',
  authenticate,
  authorize(Role.OWNER),
  settingsLimiter,
  validateCreateBookingRule,
  createBookingRule,
);

router.all('/', methodNotAllowed(['GET', 'POST']));

router.patch(
  '/:id',
  authenticate,
  authorize(Role.OWNER),
  settingsLimiter,
  validateBookingRuleIdParam,
  validateUpdateBookingRule,
  updateBookingRule,
);

router.delete(
  '/:id',
  authenticate,
  authorize(Role.OWNER),
  settingsLimiter,
  validateBookingRuleIdParam,
  deleteBookingRule,
);

router.all('/:id', methodNotAllowed(['PATCH', 'DELETE']));

module.exports = router;
