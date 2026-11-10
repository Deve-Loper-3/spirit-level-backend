const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { staffLimiter } = require('../middlewares/rateLimiter.middleware');
const { Role } = require('../constants/roles');
const { validateCreateStaff } = require('../validators/staff.validation');
const { validateCreateCoach } = require('../validators/coach.validation');
const { createStaff, createCoach } = require('../controllers/staff.controller');

const router = Router();

router.post(
  '/',
  authenticate,
  authorize(Role.ADMIN, Role.OWNER),
  staffLimiter,
  validateCreateStaff,
  createStaff,
);
router.post(
  '/coaches',
  authenticate,
  authorize(Role.ADMIN, Role.OWNER),
  staffLimiter,
  validateCreateCoach,
  createCoach,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['POST']));
router.all('/coaches', methodNotAllowed(['POST']));

module.exports = router;
