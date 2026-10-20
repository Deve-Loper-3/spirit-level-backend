const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
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
  validateListCoachesQuery,
  listCoaches,
);
// Declared before /:coachId, otherwise "me" would be read as a coach id.
router.get('/me', authenticate, authorize(Role.COACH), getMyCoach);
router.get(
  '/:coachId',
  authenticate,
  authorize(...COACH_READER_ROLES),
  validateCoachIdParam,
  getCoach,
);
router.patch(
  '/:coachId',
  authenticate,
  authorize(...COACH_MANAGER_ROLES, Role.COACH),
  validateCoachIdParam,
  validateUpdateCoach(UPDATE_FIELDS_BY_ROLE),
  createUpdateCoachHandler(UPDATE_FIELDS_BY_ROLE),
);
router.patch(
  '/:coachId/status',
  authenticate,
  authorize(...COACH_MANAGER_ROLES),
  validateCoachIdParam,
  validateCoachStatusBody,
  setCoachStatus,
);

module.exports = router;
