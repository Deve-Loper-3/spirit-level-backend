const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const bookingRuleRouter = require('../../src/routes/bookingRule.routes');
const {
  settingsLimiter,
  settingsReadLimiter,
} = require('../../src/middlewares/rateLimiter.middleware');
const { Role } = require('../../src/constants/roles');
const { seedBookingRules } = require('../../prisma/seeds/bookingRules.seed');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  snapshotBookingRules,
  restoreBookingRules,
  deleteBookingRuleAudits,
} = require('../helpers/bookingRule.helper');

jest.setTimeout(45000);

const BASE = '/api/v1/settings/booking-rules';
const WEB_ORIGIN = 'http://localhost:3000';
const MOBILE_AGENT = 'okhttp/4.12.0';

describe('Booking rules: Web + Mobile parity and rate limiter coverage', () => {
  const testData = createTestData('booking_rules_parity');
  let app;
  let snapshot;
  let owner;
  let admin;

  beforeAll(async () => {
    app = createApp();
    snapshot = await snapshotBookingRules();
    await prisma.bookingRule.deleteMany();
    await seedBookingRules();
    owner = await testData.createUser({ role: Role.OWNER });
    admin = await testData.createUser({ role: Role.ADMIN });
  });

  afterAll(async () => {
    await restoreBookingRules(snapshot);
    await deleteBookingRuleAudits([owner.id, admin.id]);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Route limiter chain audit', () => {
    const endpoints = bookingRuleRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        methods: Object.keys(layer.route.methods).filter((m) => m !== '_all'),
        chain: layer.route.stack.map((s) => s.handle),
      }))
      .filter((endpoint) => endpoint.methods.length > 0);

    it('has exactly the 4 endpoints', () => {
      expect(endpoints.flatMap((e) => e.methods).sort()).toEqual([
        'delete',
        'get',
        'patch',
        'post',
      ]);
    });

    it('puts the read limiter on GET and the write limiter on POST, PATCH and DELETE', () => {
      endpoints.forEach(({ methods, chain }) => {
        const expected = methods[0] === 'get' ? settingsReadLimiter : settingsLimiter;
        expect(chain).toContain(expected);
      });
    });

    it('rate limits after authenticating, so the counter is per user', () => {
      endpoints.forEach(({ chain }) => {
        const limiterAt = chain.findIndex((fn) => typeof fn.resetKey === 'function');
        expect(limiterAt).toBeGreaterThan(1); // authenticate and authorize come first
      });
    });
  });

  describe('Origin header vs no Origin header', () => {
    it('GET answers the same status and shape for web and mobile', async () => {
      const mobile = await request(app)
        .get(BASE)
        .set('Authorization', bearerFor(admin))
        .set('User-Agent', MOBILE_AGENT);
      const web = await request(app)
        .get(BASE)
        .set('Authorization', bearerFor(admin))
        .set('Origin', WEB_ORIGIN);

      expect(mobile.status).toBe(200);
      expect(web.status).toBe(200);
      expect(Object.keys(web.body)).toEqual(Object.keys(mobile.body));
      expect(web.body.data.categories.map((c) => c.category)).toEqual(
        mobile.body.data.categories.map((c) => c.category),
      );
      expect(web.headers['access-control-allow-origin']).toBeDefined();
    });

    it('PATCH and DELETE give the same status and shape for web and mobile', async () => {
      const idOf = async (ruleKey) =>
        (await prisma.bookingRule.findUnique({ where: { ruleKey } })).id;

      const mobilePatch = await request(app)
        .patch(`${BASE}/${await idOf('WAITLIST_MAX_PER_CLASS')}`)
        .set('Authorization', bearerFor(owner))
        .set('User-Agent', MOBILE_AGENT)
        .send({ value: 5 });
      const webPatch = await request(app)
        .patch(`${BASE}/${await idOf('MAX_GUESTS_PER_MEMBER')}`)
        .set('Authorization', bearerFor(owner))
        .set('Origin', WEB_ORIGIN)
        .send({ value: 2 });

      expect(mobilePatch.status).toBe(200);
      expect(webPatch.status).toBe(200);
      expect(Object.keys(webPatch.body.data)).toEqual(Object.keys(mobilePatch.body.data));

      const mobileDelete = await request(app)
        .delete(`${BASE}/${await idOf('LATE_FEE')}`)
        .set('Authorization', bearerFor(owner))
        .set('User-Agent', MOBILE_AGENT);
      const webDelete = await request(app)
        .delete(`${BASE}/${await idOf('CLASSPASS_ACCEPT')}`)
        .set('Authorization', bearerFor(owner))
        .set('Origin', WEB_ORIGIN);

      expect(mobileDelete.status).toBe(200);
      expect(webDelete.status).toBe(200);
      expect(webDelete.body).toEqual(mobileDelete.body);
    });

    it('POST gives the same status and shape for web and mobile', async () => {
      const mobile = await request(app)
        .post(BASE)
        .set('Authorization', bearerFor(owner))
        .set('User-Agent', MOBILE_AGENT)
        .send({ ruleKey: 'LATE_FEE' });
      const web = await request(app)
        .post(BASE)
        .set('Authorization', bearerFor(owner))
        .set('Origin', WEB_ORIGIN)
        .send({ ruleKey: 'CLASSPASS_ACCEPT' });

      expect(mobile.status).toBe(201);
      expect(web.status).toBe(201);
      expect(Object.keys(web.body)).toEqual(Object.keys(mobile.body));
      expect(Object.keys(web.body.data)).toEqual(Object.keys(mobile.body.data));
    });

    it('returns the same error envelope for web and mobile (403 for an Admin write)', async () => {
      const mobile = await request(app)
        .post(BASE)
        .set('Authorization', bearerFor(admin))
        .set('User-Agent', MOBILE_AGENT)
        .send({ ruleKey: 'LATE_FEE' });
      const web = await request(app)
        .post(BASE)
        .set('Authorization', bearerFor(admin))
        .set('Origin', WEB_ORIGIN)
        .send({ ruleKey: 'LATE_FEE' });

      expect(web.status).toBe(403);
      expect(web.body).toEqual(mobile.body);
    });
  });

  describe('CORS preflight from the web app', () => {
    it.each(['PATCH', 'DELETE', 'POST'])(
      'allows %s with the Authorization header',
      async (method) => {
        const res = await request(app)
          .options(`${BASE}/3f2b8a4e-6f4e-4c61-9d0f-0c1f7f0a9b11`)
          .set('Origin', WEB_ORIGIN)
          .set('Access-Control-Request-Method', method)
          .set('Access-Control-Request-Headers', 'authorization,content-type');

        expect(res.status).toBeLessThan(300);
        expect(res.headers['access-control-allow-methods']).toContain(method);
        expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain(
          'authorization',
        );
      },
    );

    it('exposes Allow and the rate limit headers to the browser', async () => {
      const res = await request(app)
        .get(BASE)
        .set('Authorization', bearerFor(admin))
        .set('Origin', WEB_ORIGIN);
      const exposed = (res.headers['access-control-expose-headers'] || '').toLowerCase();
      expect(exposed).toContain('allow');
      expect(exposed).toContain('retry-after');
      expect(exposed).toContain('ratelimit-remaining');
    });
  });

  describe('405 path is rate limited and answers both clients alike', () => {
    it('answers 405 with Allow for web and mobile', async () => {
      const mobile = await request(app).put(BASE).set('User-Agent', MOBILE_AGENT);
      const web = await request(app).put(BASE).set('Origin', WEB_ORIGIN);

      expect(mobile.status).toBe(405);
      expect(web.status).toBe(405);
      expect(web.headers.allow).toBe('GET, POST');
      expect(web.body).toEqual(mobile.body);
      expect(mobile.headers['ratelimit-limit']).toBeDefined();
    });
  });
});
