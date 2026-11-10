const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { classLimiter, classReadLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const { Role } = require('../constants/roles');
const { validateSessionIdParam } = require('../validators/idParam.validation');
const {
  validateListSessionsQuery,
  validateCreateSessionBody,
  validatePatchSessionBody,
  validateCancelSessionBody,
} = require('../validators/schedule.validation');
const {
  listSessions,
  getSession,
  createSession,
  patchSession,
  cancelSession,
  restoreSession,
} = require('../controllers/schedule.controller');

const router = Router();

// GET /api/v1/sessions - Calendar read / list sessions
router.get(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  classReadLimiter,
  validateListSessionsQuery,
  listSessions,
);

// POST /api/v1/sessions - Create one-off session instance (BE-SCH-1 / BE-SCH-3)
router.post(
  '/',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  validateCreateSessionBody,
  createSession,
);
router.all('/', methodNotAllowed(['GET', 'POST']));

// POST /api/v1/sessions/:id/cancel - Cancel session
router.post(
  '/:id/cancel',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  classLimiter,
  validateSessionIdParam,
  validateCancelSessionBody,
  cancelSession,
);
router.all('/:id/cancel', methodNotAllowed(['POST']));

// POST /api/v1/sessions/:id/restore - Restore cancelled session
router.post(
  '/:id/restore',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  classLimiter,
  validateSessionIdParam,
  restoreSession,
);
router.all('/:id/restore', methodNotAllowed(['POST']));

// GET /api/v1/sessions/:id - Get session details
router.get(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER),
  classReadLimiter,
  validateSessionIdParam,
  getSession,
);

// PATCH /api/v1/sessions/:id - Update session
router.patch(
  '/:id',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.COACH),
  classLimiter,
  validateSessionIdParam,
  validatePatchSessionBody,
  patchSession,
);
router.all('/:id', methodNotAllowed(['GET', 'PATCH']));

module.exports = router;
