const { Router } = require('express');
const { validateBody } = require('../middlewares/validate.middleware');
const { authLimiter } = require('../middlewares/rateLimiter.middleware');
const { registerSchema, completeRegistrationSchema, loginSchema } = require('../validators/auth.validation');
const { register, completeRegister, login } = require('../controllers/auth.controller');

const router = Router();

router.post('/register', authLimiter, validateBody(registerSchema), register);
router.post(
  '/register/complete',
  authLimiter,
  validateBody(completeRegistrationSchema),
  completeRegister,
);

router.post('/login', authLimiter, validateBody(loginSchema), login);

module.exports = router;
