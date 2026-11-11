const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

const createAuthLimiter = (options = {}) => {
  const isTest = env.NODE_ENV === 'test';
  // In test environment, default to a very high limit unless RATE_LIMIT_MAX is explicitly set in env or options
  const hasEnvMax = Boolean(process.env.RATE_LIMIT_MAX);
  const defaultMax = hasEnvMax ? env.RATE_LIMIT_MAX : isTest ? 100000 : env.RATE_LIMIT_MAX;
  const max = options.max !== undefined ? options.max : defaultMax;
  const windowMs = options.windowMs !== undefined ? options.windowMs : env.RATE_LIMIT_WINDOW_MS;

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(createAppError(AppErrors.TOO_MANY_REQUESTS));
    },
    ...options,
    max,
  });
};

const authLimiter = createAuthLimiter();

const planKeyGenerator = (req) => {
  const ipKey = ipKeyGenerator(req.ip);
  return req.user?.id ? `${req.user.id}_${ipKey}` : ipKey;
};

const createPlanLimiter = (options = {}) =>
  createAuthLimiter({
    keyGenerator: planKeyGenerator,
    ...options,
  });

const planLimiter = createPlanLimiter();
// Reads get their own counter so browsing the list never uses up the create budget.
const planReadLimiter = createPlanLimiter();

const classLimiter = createPlanLimiter();
const classReadLimiter = createPlanLimiter();

const cafeLimiter = createPlanLimiter();
const cafeReadLimiter = createPlanLimiter();

// Studio settings (booking rules): reads and writes count separately.
const settingsLimiter = createPlanLimiter();
const settingsReadLimiter = createPlanLimiter();

// Appointment types and appointments share one pair: reads and writes count separately.
const appointmentLimiter = createPlanLimiter();
const appointmentReadLimiter = createPlanLimiter();

// In-app notifications of the signed-in user: reads and writes count separately.
const notificationLimiter = createPlanLimiter();
const notificationReadLimiter = createPlanLimiter();

const staffLimiter = createPlanLimiter();
const coachLimiter = createPlanLimiter();
const coachReadLimiter = createPlanLimiter();
// Own profile reads and profile-image updates: any signed-in role.
const profileLimiter = createPlanLimiter();

// Endpoints with no signed-in user (readiness probe, API docs, 404 fallback, 405 handlers):
// IP only. One shared counter, so scanning unknown URLs cannot hide behind many different paths.
const publicLimiter = createAuthLimiter();

module.exports = {
  createAuthLimiter,
  authLimiter,
  createPlanLimiter,
  planLimiter,
  planReadLimiter,
  classLimiter,
  classReadLimiter,
  cafeLimiter,
  cafeReadLimiter,
  settingsLimiter,
  settingsReadLimiter,
  appointmentLimiter,
  appointmentReadLimiter,
  notificationLimiter,
  notificationReadLimiter,
  staffLimiter,
  coachLimiter,
  coachReadLimiter,
  profileLimiter,
  publicLimiter,
};
