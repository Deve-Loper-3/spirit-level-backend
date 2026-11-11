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
  validateSaveWeeklyAvailabilityBody,
  validateCreateUnavailabilityBody,
  validateUpdateUnavailabilityBody,
  validateUnavailabilityParams,
  validateListUnavailabilityQuery,
} = require('../validators/coachAvailability.validation');
const { validateEligibleCoachesQuery } = require('../validators/coachEligibility.validation');
const { listEligibleCoaches } = require('../controllers/coachEligibility.controller');
const { validateOpenSlotsQuery } = require('../validators/coachSlots.validation');
const { getOpenSlots } = require('../controllers/coachSlots.controller');
const {
  listCoaches,
  getCoach,
  getMyCoach,
  createUpdateCoachHandler,
  setCoachStatus,
} = require('../controllers/coach.controller');
const {
  getWeeklyAvailability,
  saveWeeklyAvailability,
} = require('../controllers/coachAvailability.controller');
const {
  listUnavailability,
  createUnavailability,
  updateUnavailability,
  deleteUnavailability,
} = require('../controllers/coachUnavailability.controller');

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
// Coach picker for a time slot (SLAPP 66/111 S7), managers only. Declared before /:coachId, otherwise
// "eligible" would be read as a coach id.
router.get(
  '/eligible',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachReadLimiter,
  validateEligibleCoachesQuery,
  listEligibleCoaches,
);
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

// Weekly availability (SLAPP 66/111). Managers read and replace any coach's week; a coach reads
// only their own (coach.access.assertCanViewAvailability) and can never save.
router.get(
  '/:coachId/availability',
  authenticate,
  authorize(...COACH_MANAGER_ROLES, Role.COACH),
  coachReadLimiter,
  validateCoachIdParam,
  getWeeklyAvailability,
);
router.put(
  '/:coachId/availability',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachLimiter,
  validateCoachIdParam,
  validateSaveWeeklyAvailabilityBody,
  saveWeeklyAvailability,
);

// Open appointment slots (SLAPP 66/111 S8): free start times of one coach for one appointment type.
// Managers any coach, a coach only their own (coachSlots.service answers 403 for another coach).
router.get(
  '/:coachId/availability/slots',
  authenticate,
  authorize(...COACH_MANAGER_ROLES, Role.COACH),
  coachReadLimiter,
  validateCoachIdParam,
  validateOpenSlotsQuery,
  getOpenSlots,
);

// Coach unavailability / leave (SLAPP 66/111). Managers read and write any coach's leave; a coach
// reads only their own (coach.access.assertCanViewAvailability) and can never write.
router.get(
  '/:coachId/unavailability',
  authenticate,
  authorize(...COACH_MANAGER_ROLES, Role.COACH),
  coachReadLimiter,
  validateCoachIdParam,
  validateListUnavailabilityQuery,
  listUnavailability,
);
router.post(
  '/:coachId/unavailability',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachLimiter,
  validateCoachIdParam,
  validateCreateUnavailabilityBody,
  createUnavailability,
);
router.patch(
  '/:coachId/unavailability/:unavailabilityId',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachLimiter,
  validateUnavailabilityParams,
  validateUpdateUnavailabilityBody,
  updateUnavailability,
);
router.delete(
  '/:coachId/unavailability/:unavailabilityId',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  coachLimiter,
  validateUnavailabilityParams,
  deleteUnavailability,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/eligible', methodNotAllowed(['GET']));
router.all('/:coachId', methodNotAllowed(['GET', 'PATCH']));
router.all('/:coachId/status', methodNotAllowed(['PATCH']));
router.all('/:coachId/availability', methodNotAllowed(['GET', 'PUT']));
router.all('/:coachId/availability/slots', methodNotAllowed(['GET']));
router.all('/:coachId/unavailability', methodNotAllowed(['GET', 'POST']));
router.all('/:coachId/unavailability/:unavailabilityId', methodNotAllowed(['PATCH', 'DELETE']));

module.exports = router;
