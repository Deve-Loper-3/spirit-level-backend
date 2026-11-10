const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { coachLimiter, coachReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { Role } = require('../constants/roles');
const {
  COACH_MANAGER_ROLES,
  COACH_READER_ROLES,
  UPDATE_FIELDS_BY_ROLE,
} = require('../constants/coach');
const {
  validateListCoachesQuery,
  validateCoachIdParam,
  validateUpdateCoach,
  validateCoachStatusBody,
} = require('../validators/coach.validation');
const {
  listCoaches,
  getCoach,
  getMyCoach,
  createUpdateCoachHandler,
  setCoachStatus,
} = require('../controllers/coach.controller');

const router = Router();

// Who may do what is decided twice: here by role, and in coach.service by ownership and visibility.
router.get(
  '/',
  authenticate,
  authorize(...COACH_READER_ROLES),
  coachReadLimiter,
  validateListCoachesQuery,
  listCoaches,
);
// Declared before /:coachId, otherwise "me" would be read as a coach id.
router.get('/me', authenticate, authorize(Role.COACH), coachReadLimiter, getMyCoach);
router.get(
  '/:coachId',
  authenticate,
  authorize(...COACH_READER_ROLES),
  coachReadLimiter,
  validateCoachIdParam,
  getCoach,
);
router.patch(
  '/:coachId',
  authenticate,
  authorize(...COACH_MANAGER_ROLES, Role.COACH),
  coachLimiter,
  validateCoachIdParam,
  validateUpdateCoach(UPDATE_FIELDS_BY_ROLE),
  createUpdateCoachHandler(UPDATE_FIELDS_BY_ROLE),
);
router.patch(
  '/:coachId/status',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachLimiter,
  validateCoachIdParam,
  validateCoachStatusBody,
  setCoachStatus,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/:coachId', methodNotAllowed(['GET', 'PATCH']));
router.all('/:coachId/status', methodNotAllowed(['PATCH']));

module.exports = router;
