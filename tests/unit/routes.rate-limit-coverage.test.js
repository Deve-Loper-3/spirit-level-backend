const authRoutes = require('../../src/routes/auth.routes');
const uploadsRoutes = require('../../src/routes/uploads.routes');
const staffRoutes = require('../../src/routes/staff.routes');
const coachRoutes = require('../../src/routes/coach.routes');
const planRoutes = require('../../src/routes/plan.routes');
const membershipRoutes = require('../../src/routes/membership.routes');
const classRoutes = require('../../src/routes/class.routes');
const sessionRoutes = require('../../src/routes/session.routes');
const cafeRoutes = require('../../src/routes/cafe.routes');
const bookingRuleRoutes = require('../../src/routes/bookingRule.routes');
const appointmentTypeRoutes = require('../../src/routes/appointmentType.routes');
const appointmentRoutes = require('../../src/routes/appointment.routes');
const notificationRoutes = require('../../src/routes/notification.routes');
const healthRoutes = require('../../src/routes/health.routes');
const { createDocsRouter } = require('../../src/routes/docs.routes');

// express-rate-limit attaches resetKey/getKey to the middleware it returns.
const isRateLimiter = (handler) =>
  typeof handler.resetKey === 'function' && typeof handler.getKey === 'function';

const routesWithoutLimiter = (router) =>
  router.stack
    .filter((layer) => layer.route)
    .filter((layer) => !layer.route.stack.some((l) => isRateLimiter(l.handle)))
    .map(
      (layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`,
    );

describe('every route has a rate limiter', () => {
  it.each([
    ['auth', authRoutes],
    ['uploads', uploadsRoutes],
    ['staff', staffRoutes],
    ['coaches', coachRoutes],
    ['plans', planRoutes],
    ['memberships', membershipRoutes],
    ['classes', classRoutes],
    ['sessions', sessionRoutes],
    ['cafe', cafeRoutes],
    ['booking rules', bookingRuleRoutes],
    ['appointment types', appointmentTypeRoutes],
    ['appointments', appointmentRoutes],
    ['notifications', notificationRoutes],
  ])('%s router', (_name, router) => {
    expect(routesWithoutLimiter(router)).toEqual([]);
  });

  it('health router: only the liveness probe (GET /) is unlimited', () => {
    expect(routesWithoutLimiter(healthRoutes)).toEqual(['GET /']);
  });

  it('docs router is limited before it serves anything', () => {
    const first = createDocsRouter().stack[0];
    expect(isRateLimiter(first.handle)).toBe(true);
  });
});
