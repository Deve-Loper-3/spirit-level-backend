const { Router } = require('express');
const { validateBody } = require('../middlewares/validate.middleware');
const { createAuthLimiter, profileLimiter } = require('../middlewares/rateLimiter.middleware');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const {
  profileImageTokenSchema,
  updateProfileImageSchema,
} = require('../validators/uploads.validation');
const { issueProfileImageToken, updateProfileImage } = require('../controllers/uploads.controller');

const router = Router();

// Public (users upload before they have an account), so it gets its own rate-limit counter.
const tokenLimiter = createAuthLimiter();

router.post(
  '/profile-image/token',
  tokenLimiter,
  validateBody(profileImageTokenSchema),
  issueProfileImageToken,
);

router.patch(
  '/profile-image',
  authenticate,
  profileLimiter,
  validateBody(updateProfileImageSchema),
  updateProfileImage,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/profile-image/token', methodNotAllowed(['POST']));
router.all('/profile-image', methodNotAllowed(['PATCH']));

module.exports = router;
