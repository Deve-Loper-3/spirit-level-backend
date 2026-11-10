const { Router } = require('express');
const env = require('../config/env');
const { validateBody } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');
const {
  authLimiter,
  createAuthLimiter,
  profileLimiter,
} = require('../middlewares/rateLimiter.middleware');
const {
  registerSchema,
  completeRegistrationSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} = require('../validators/auth.validation');
const {
  register,
  completeRegister,
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  verifyOtp,
  resetPassword,
} = require('../controllers/auth.controller');

const router = Router();

// Guesses refresh tokens, and clients call it often, so it gets its own counter
// (separate from the login counter in authLimiter). Logout takes the same token, so it shares it.
// Stricter than the login limit: configured with REFRESH_RATE_LIMIT_MAX / _WINDOW_MS.
const refreshLimiter = createAuthLimiter({
  max: env.refreshRateLimitMax,
  windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
});
// Sends an email, so it gets its own rate-limit counter (separate from authLimiter).
const forgotPasswordLimiter = createAuthLimiter();
// Guesses OTPs, so it also gets its own counter.
const verifyOtpLimiter = createAuthLimiter();
// Guesses reset tokens, so it also gets its own counter.
const resetPasswordLimiter = createAuthLimiter();

router.post('/register', authLimiter, validateBody(registerSchema), register);
router.post(
  '/register/complete',
  authLimiter,
  validateBody(completeRegistrationSchema),
  completeRegister,
);

router.post('/login', authLimiter, validateBody(loginSchema), login);

router.post('/refresh', refreshLimiter, validateBody(refreshTokenSchema), refresh);

router.post('/logout', refreshLimiter, authenticate, validateBody(refreshTokenSchema), logout);

// Any authenticated, active role may read its own profile.
router.get('/me', authenticate, profileLimiter, me);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);

router.post('/verify-otp', verifyOtpLimiter, validateBody(verifyOtpSchema), verifyOtp);

router.post(
  '/reset-password',
  resetPasswordLimiter,
  validateBody(resetPasswordSchema),
  resetPassword,
);

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/register', methodNotAllowed(['POST']));
router.all('/register/complete', methodNotAllowed(['POST']));
router.all('/login', methodNotAllowed(['POST']));
router.all('/refresh', methodNotAllowed(['POST']));
router.all('/logout', methodNotAllowed(['POST']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/forgot-password', methodNotAllowed(['POST']));
router.all('/verify-otp', methodNotAllowed(['POST']));
router.all('/reset-password', methodNotAllowed(['POST']));

module.exports = router;
