const { Router } = require('express');
const { validateBody } = require('../middlewares/validate.middleware');
const { createAuthLimiter } = require('../middlewares/rateLimiter.middleware');
const { authenticate } = require('../middlewares/authenticate.middleware');
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
  validateBody(updateProfileImageSchema),
  updateProfileImage,
);

module.exports = router;
