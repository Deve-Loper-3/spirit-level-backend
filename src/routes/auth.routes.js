const { Router } = require('express');
const env = require('../config/env');
const { validateBody } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/authenticate.middleware');
const { authorize } = require('../middlewares/authorize.middleware');
const { Role } = require('../constants/roles');
const { authLimiter, createAuthLimiter } = require('../middlewares/rateLimiter.middleware');
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
  getMe,
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

router.get('/me', authenticate, authorize(...Object.values(Role)), getMe);

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

module.exports = router;
