const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const cafeRouter = require('../../src/routes/cafe.routes');
const { cafeLimiter, cafeReadLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestCafeCategories } = require('../helpers/cafe.helper');

jest.setTimeout(45000);

describe('Cafe Web & Mobile Parity and Route Rate Limiter Coverage', () => {
  const PREFIX = 'test_parity_';
  const testData = createTestData('cafe_parity');
  let app;
  let adminUser;
  let memberUser;

  const cleanup = async () => {
    await deleteTestCafeCategories(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN });
    memberUser = await testData.createUser({ role: Role.MEMBER });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Route Limiter Chain Audit', () => {
    it('verifies every registered endpoint under /api/v1/cafe has a limiter in its middleware chain', () => {
      const routeLayers = cafeRouter.stack.filter((layer) => layer.route);

      // We expect 12 endpoints (11 catalogue + SLAPP-79/81 stock) + 405 handlers
      const auditedEndpoints = [];

      for (const layer of routeLayers) {
        const methods = Object.keys(layer.route.methods).filter((m) => m !== '_all');
        if (methods.length === 0) continue; // Skip 405 router.all layers

        const routePath = layer.route.path;
        const middlewares = layer.route.stack.map((m) => m.handle);

        const hasLimiter = middlewares.some(
          (fn) =>
            fn === cafeLimiter ||
            fn === cafeReadLimiter ||
            (typeof fn === 'function' && typeof fn.resetKey === 'function'),
        );

        auditedEndpoints.push({
          methods,
          path: routePath,
          hasLimiter,
        });
      }

      expect(auditedEndpoints.length).toBe(12);
      for (const endpoint of auditedEndpoints) {
        expect(endpoint.hasLimiter).toBe(true);
      }
    });
  });

  describe('Web + Mobile Parity (Origin header vs no Origin header)', () => {
    it('returns the same status and body shape on cafe GET /categories with and without Origin header', async () => {
      // 1. Mobile request (No Origin header)
      const mobileRes = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(memberUser))
        .set('User-Agent', 'okhttp/4.12.0');

      // 2. Web browser request (With Origin header)
      const webRes = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(memberUser))
        .set('Origin', 'http://localhost:3000');

      expect(mobileRes.status).toBe(200);
      expect(webRes.status).toBe(200);

      expect(webRes.body.success).toBe(mobileRes.body.success);
      expect(webRes.body.data.length).toBe(mobileRes.body.data.length);
      expect(Object.keys(webRes.body)).toEqual(Object.keys(mobileRes.body));

      // Browser receives CORS headers, mobile does not require them
      expect(webRes.headers['access-control-allow-origin']).toBeDefined();
    });

    it('returns the same status, body shape, and Location header on cafe POST /categories with and without Origin header', async () => {
      const mobileName = `${PREFIX}MobileCat_${Date.now()}`;
      const webName = `${PREFIX}WebCat_${Date.now()}`;

      // 1. Mobile write (No Origin header)
      const mobileRes = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .set('User-Agent', 'okhttp/4.12.0')
        .send({ name: mobileName, description: 'Created by Mobile' });

      // 2. Web write (With Origin header)
      const webRes = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .set('Origin', 'http://localhost:3000')
        .send({ name: webName, description: 'Created by Web' });

      expect(mobileRes.status).toBe(201);
      expect(webRes.status).toBe(201);

      expect(mobileRes.body.success).toBe(true);
      expect(webRes.body.success).toBe(true);

      // Verify identical response structure
      expect(Object.keys(webRes.body.data)).toEqual(Object.keys(mobileRes.body.data));
      expect(mobileRes.headers.location).toMatch(/^\/api\/v1\/cafe\/categories\/[0-9a-f-]+$/);
      expect(webRes.headers.location).toMatch(/^\/api\/v1\/cafe\/categories\/[0-9a-f-]+$/);

      // Browser gets CORS allow-origin and exposed Location
      expect(webRes.headers['access-control-allow-origin']).toBeDefined();
      const exposedHeaders = webRes.headers['access-control-expose-headers'] || '';
      expect(exposedHeaders.toLowerCase()).toContain('location');
    });

    it('returns the same status and body shape on cafe GET /items with and without Origin header', async () => {
      // 1. Mobile request
      const mobileRes = await request(app)
        .get('/api/v1/cafe/items')
        .set('Authorization', bearerFor(memberUser))
        .set('User-Agent', 'okhttp/4.12.0');

      // 2. Web browser request
      const webRes = await request(app)
        .get('/api/v1/cafe/items')
        .set('Authorization', bearerFor(memberUser))
        .set('Origin', 'http://localhost:3000');

      expect(mobileRes.status).toBe(200);
      expect(webRes.status).toBe(200);

      expect(webRes.body.success).toBe(mobileRes.body.success);
      expect(webRes.body.data.length).toBe(mobileRes.body.data.length);
      expect(webRes.body.pagination).toEqual(mobileRes.body.pagination);
    });
  });
});
