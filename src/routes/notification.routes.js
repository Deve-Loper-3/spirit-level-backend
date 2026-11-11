const { Router } = require('express');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const {
  notificationLimiter,
  notificationReadLimiter,
} = require('../middlewares/rateLimiter.middleware');
const { Role } = require('../constants/roles');
const {
  validateListNotificationsQuery,
  validateEmptyQuery,
  validateNotificationParams,
} = require('../validators/notification.validation');
const {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notification.controller');

const router = Router();
const ANY_ROLE = [Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER];

// Own notifications only, any signed-in role (the service filters by the caller's user id). The fixed
// paths are declared before /:notificationId/read.
router.get(
  '/',
  authenticate,
  authorize(...ANY_ROLE),
  notificationReadLimiter,
  validateListNotificationsQuery,
  listNotifications,
);
router.get(
  '/unread-count',
  authenticate,
  authorize(...ANY_ROLE),
  notificationReadLimiter,
  validateEmptyQuery,
  getUnreadCount,
);
router.post(
  '/read-all',
  authenticate,
  authorize(...ANY_ROLE),
  notificationLimiter,
  validateEmptyQuery,
  markAllNotificationsRead,
);
router.patch(
  '/:notificationId/read',
  authenticate,
  authorize(...ANY_ROLE),
  notificationLimiter,
  validateNotificationParams,
  validateEmptyQuery,
  markNotificationRead,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET']));
router.all('/unread-count', methodNotAllowed(['GET']));
router.all('/read-all', methodNotAllowed(['POST']));
router.all('/:notificationId/read', methodNotAllowed(['PATCH']));

module.exports = router;
