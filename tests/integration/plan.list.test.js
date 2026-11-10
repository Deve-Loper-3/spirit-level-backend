const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const planRoutes = require('../../src/routes/plan.routes');
const {
  createPlanLimiter,
  planReadLimiter,
} = require('../../src/middlewares/rateLimiter.middleware');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('GET /api/v1/plans', () => {
  const TEST_PREFIX = 'test_slmp03_';
  const testData = createTestData('slmp03_plans');
  let app;
  let ownerUser;
  let adminUser;
  let coachUser;
  let memberUser;
  let priciestId;

  const createPlan = (overrides = {}) =>
    prisma.membershipPlan.create({
      data: {
        id: crypto.randomUUID(),
        name: `${TEST_PREFIX}${crypto.randomUUID()}`,
        kind: 'SUBSCRIPTION',
        price: 100,
        billingCycle: 'MONTH',
        creditType: 'CLASS',
        creditsIncluded: 10,
        validityValue: 1,
        validityUnit: 'MONTH',
        startsOn: 'PURCHASE_DATE',
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        ...overrides,
      },
    });

  const getAs = (user, query = {}) =>
    request(app).get('/api/v1/plans').set('Authorization', bearerFor(user)).query(query);

  const listAll = async (query = {}) => {
    const res = await getAs(ownerUser, { limit: 100, ...query });
    expect(res.status).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    app = createApp();
    await deleteTestPlans(TEST_PREFIX);
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Tester' });
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Tester' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Tester' });

    const priciest = await createPlan({
      name: `${TEST_PREFIX}Priciest`,
      price: 99999,
      description: 'the most expensive plan',
    });
    priciestId = priciest.id;
    await createPlan({
      name: `${TEST_PREFIX}Inactive Hidden Pack`,
      kind: 'CREDIT_PACK',
      billingCycle: 'ONE_OFF',
      status: 'INACTIVE',
      visibility: 'HIDDEN',
    });
    await createPlan({
      name: `${TEST_PREFIX}Archived Plan`,
      status: 'ARCHIVED',
      description: 'only visible when archived is asked for',
    });
    await createPlan({
      name: `${TEST_PREFIX}Trial Offer`,
      kind: 'TRIAL',
      billingCycle: 'ONE_OFF',
      price: 0,
      creditsIncluded: 1,
    });
    await createPlan({
      name: `${TEST_PREFIX}50% Off_Deal`,
      kind: 'SINGLE_VISIT',
      billingCycle: 'ONE_OFF',
    });
  });

  afterAll(async () => {
    await deleteTestPlans(TEST_PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Authorization', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/api/v1/plans');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 for a Member and no data', async () => {
      const res = await getAs(memberUser);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body).not.toHaveProperty('data');
    });

    it.each([
      ['Owner', () => ownerUser],
      ['Admin', () => adminUser],
      ['Coach', () => coachUser],
    ])('returns 200 for a %s', async (_label, user) => {
      const res = await getAs(user());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Response shape', () => {
    it('returns the short list item and pagination and counts', async () => {
      const body = await listAll({ q: 'Priciest' });

      expect(body.data).toHaveLength(1);
      expect(Object.keys(body.data[0]).sort()).toEqual(
        [
          'id',
          'name',
          'section',
          'kind',
          'price',
          'billingCycle',
          'creditType',
          'creditSummary',
          'visibility',
          'status',
          'activeClientCount',
          'membershipId',
          'membership',
        ].sort(),
      );
      expect(body.data[0]).toMatchObject({
        id: priciestId,
        section: 'class_membership',
        kind: 'subscription',
        price: 99999,
        billingCycle: 'month',
        creditType: 'class',
        creditSummary: '10 class credits',
        visibility: 'public',
        status: 'active',
        activeClientCount: 0,
      });
      expect(body.pagination).toEqual({ page: 1, limit: 100, total: 1, totalPages: 1 });
      expect(body.counts).toEqual(
        expect.objectContaining({
          class_membership: expect.any(Number),
          online_coaching: 7,
        }),
      );
      expect(body).not.toHaveProperty('meta');
    });

    it('defaults to page 1, 20 items per page', async () => {
      const res = await getAs(ownerUser);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.pagination.total).toBeGreaterThan(60);
    });
  });

  describe('Section filter', () => {
    it('online_coaching gives 7 plans and no class plan', async () => {
      const body = await listAll({ section: 'online_coaching' });
      expect(body.pagination.total).toBe(7);
      expect(body.data).toHaveLength(7);
      body.data.forEach((plan) => {
        expect(plan.section).toBe('online_coaching');
        expect(plan.creditType).toBe('time');
      });
    });

    it('class_membership gives no coaching plan', async () => {
      const body = await listAll({ section: 'class_membership' });
      expect(body.pagination.total).toBeGreaterThanOrEqual(53);
      body.data.forEach((plan) => {
        expect(plan.section).toBe('class_membership');
        expect(plan.creditType).not.toBe('time');
      });
    });

    it('omitting section returns both', async () => {
      const body = await listAll();
      const sections = new Set(body.data.map((plan) => plan.section));
      expect(sections).toEqual(new Set(['class_membership', 'online_coaching']));
    });

    it('section and a conflicting creditType give an empty page, not an error', async () => {
      const body = await listAll({ section: 'online_coaching', creditType: 'class' });
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });
  });

  describe('Other filters', () => {
    it('kind filters on the plan kind', async () => {
      const body = await listAll({ kind: 'trial' });
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((plan) => expect(plan.kind).toBe('trial'));
    });

    it('creditType filters on the credit type', async () => {
      const body = await listAll({ creditType: 'facility' });
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((plan) => expect(plan.creditType).toBe('facility'));
    });

    it('visibility filters on public or hidden', async () => {
      const body = await listAll({ visibility: 'hidden' });
      expect(body.data.map((plan) => plan.name)).toContain(`${TEST_PREFIX}Inactive Hidden Pack`);
      body.data.forEach((plan) => expect(plan.visibility).toBe('hidden'));
    });

    it('accepts filters in any letter case and ignores blank ones', async () => {
      const body = await listAll({ section: 'ONLINE_COACHING', kind: '', status: '' });
      expect(body.pagination.total).toBe(7);
    });
  });

  describe('Status filter', () => {
    it('never returns archived plans by default', async () => {
      const body = await listAll();
      const statuses = new Set(body.data.map((plan) => plan.status));
      expect(statuses).toContain('active');
      expect(statuses).toContain('inactive');
      expect(statuses).not.toContain('archived');
      expect(body.data.map((plan) => plan.name)).not.toContain(`${TEST_PREFIX}Archived Plan`);
    });

    it('status=archived returns only archived plans', async () => {
      const body = await listAll({ status: 'archived' });
      expect(body.data.map((plan) => plan.name)).toContain(`${TEST_PREFIX}Archived Plan`);
      body.data.forEach((plan) => expect(plan.status).toBe('archived'));
    });

    it('accepts a comma list', async () => {
      const body = await listAll({ status: 'inactive,archived' });
      const statuses = new Set(body.data.map((plan) => plan.status));
      expect(statuses).toEqual(new Set(['inactive', 'archived']));
    });

    it('status=active hides inactive plans', async () => {
      const body = await listAll({ status: 'active' });
      body.data.forEach((plan) => expect(plan.status).toBe('active'));
    });
  });

  describe('Search (q)', () => {
    it('q=nutrition returns both nutrition coaching plans', async () => {
      const body = await listAll({ q: 'nutrition' });
      expect(body.data.map((plan) => plan.name).sort()).toEqual([
        'Hyrox Personalised Programming + Nutrition',
        'Nutrition Coaching',
      ]);
      expect(body.pagination.total).toBe(2);
    });

    it('is case-insensitive', async () => {
      const body = await listAll({ q: 'NUTRITION' });
      expect(body.pagination.total).toBe(2);
    });

    it('searches the description', async () => {
      const body = await listAll({ q: 'most expensive' });
      expect(body.data.map((plan) => plan.id)).toEqual([priciestId]);
    });

    it('searches the kind label', async () => {
      const body = await listAll({ q: 'single visit' });
      expect(body.data.map((plan) => plan.name)).toContain(`${TEST_PREFIX}50% Off_Deal`);
      body.data.forEach((plan) => expect(plan.kind).toBe('single_visit'));
    });

    it('treats % and _ as plain text', async () => {
      const body = await listAll({ q: '50% off_deal' });
      expect(body.data.map((plan) => plan.name)).toEqual([`${TEST_PREFIX}50% Off_Deal`]);
      expect((await listAll({ q: '%' })).data.length).toBeLessThan(5);
    });

    it('does not return archived plans unless the status asks for them', async () => {
      const without = await listAll({ q: 'only visible when archived' });
      expect(without.data).toEqual([]);
      const withArchived = await listAll({ q: 'only visible when archived', status: 'archived' });
      expect(withArchived.data).toHaveLength(1);
    });

    it('returns an empty page when nothing matches', async () => {
      const body = await listAll({ q: 'zzz-no-such-plan' });
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });
  });

  describe('Sorting', () => {
    it('sort=-price puts the most expensive plan first', async () => {
      const body = await listAll({ sort: '-price' });
      expect(body.data[0].id).toBe(priciestId);
      const prices = body.data.map((plan) => plan.price);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
    });

    it('sort=price puts the cheapest plan first', async () => {
      const body = await listAll({ sort: 'price' });
      const prices = body.data.map((plan) => plan.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('sort=-createdAt works', async () => {
      const res = await getAs(ownerUser, { sort: '-createdAt' });
      expect(res.status).toBe(200);
    });

    it('sorts by name ignoring case by default', async () => {
      const body = await listAll();
      const names = body.data.map((plan) => plan.name.toLowerCase());
      expect(names).toEqual([...names].sort());
      const original = body.data.map((plan) => plan.name);
      expect(original.indexOf('Single Class')).toBeLessThan(
        original.indexOf('STRDY X ROXSTARS (10 Class Pack)'),
      );
      expect(original.indexOf('HEROX Programme (Female-specific)')).toBeLessThan(
        original.indexOf('Hyrox Beginner Program (12 week plan)'),
      );
    });

    it('sort=-name is the exact reverse of sort=name', async () => {
      const asc = (await listAll({ sort: 'name' })).data.map((plan) => plan.id);
      const desc = (await listAll({ sort: '-name' })).data.map((plan) => plan.id);
      expect(desc).toEqual([...asc].reverse());
    });
  });

  describe('Paging', () => {
    it.each(['name', '-name', 'price', '-createdAt'])(
      'pages through every plan exactly once with sort=%s',
      async (sort) => {
        const first = await getAs(ownerUser, { sort, limit: 25, page: 1 });
        const { total } = first.body.pagination;
        const ids = [];
        for (let page = 1; page <= Math.ceil(total / 25); page += 1) {
          const res = await getAs(ownerUser, { sort, limit: 25, page });
          expect(res.body.pagination.page).toBe(page);
          ids.push(...res.body.data.map((plan) => plan.id));
        }
        expect(ids).toHaveLength(total);
        expect(new Set(ids).size).toBe(total);
      },
    );

    it('returns an empty page, with the real total, past the last page', async () => {
      const res = await getAs(ownerUser, { page: 99, limit: 20 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBeGreaterThan(60);
    });
  });

  describe('Both list paths agree (name order in SQL vs Prisma column order)', () => {
    const filterSets = [
      {},
      { section: 'online_coaching' },
      { section: 'class_membership', kind: 'subscription' },
      { q: 'hyrox' },
      { q: 'nutrition', status: 'active,inactive' },
      { status: 'archived' },
      { status: 'active,inactive,archived' },
      { visibility: 'hidden' },
      { creditType: 'appointment', q: 'training' },
    ];

    it.each(filterSets.map((filters) => [JSON.stringify(filters), filters]))(
      'gives the same total and plans for %s',
      async (_label, filters) => {
        const byName = await listAll({ ...filters, sort: 'name' });
        const byPrice = await listAll({ ...filters, sort: 'price' });

        expect(byName.pagination.total).toBe(byPrice.pagination.total);
        expect(byName.data.map((plan) => plan.id).sort()).toEqual(
          byPrice.data.map((plan) => plan.id).sort(),
        );
        expect(byName.counts).toEqual(byPrice.counts);
      },
    );
  });

  describe('counts', () => {
    it('counts all non-archived plans per section', async () => {
      const body = await listAll();
      const counts = await prisma.membershipPlan.groupBy({
        by: ['creditType'],
        where: { status: { not: 'ARCHIVED' } },
        _count: { _all: true },
      });
      const online = counts.find((c) => c.creditType === 'TIME')._count._all;
      const total = counts.reduce((sum, c) => sum + c._count._all, 0);
      expect(body.counts).toEqual({
        class_membership: total - online,
        online_coaching: online,
      });
      expect(body.counts.online_coaching).toBe(7);
    });

    it.each([
      { q: 'nutrition' },
      { q: 'zzz-no-such-plan' },
      { status: 'archived' },
      { status: 'inactive' },
      { section: 'online_coaching' },
      { kind: 'trial', visibility: 'public', creditType: 'class' },
      { page: 3, limit: 5 },
    ])('stay unchanged with %j', async (query) => {
      const baseline = (await listAll()).counts;
      const res = await getAs(ownerUser, query);
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual(baseline);
    });
  });

  describe('Validation (400)', () => {
    it.each([
      ['section', { section: 'both' }],
      ['kind', { kind: 'gift' }],
      ['creditType', { creditType: 'money' }],
      ['visibility', { visibility: 'secret' }],
      ['status', { status: 'active,deleted' }],
      ['sort', { sort: 'email' }],
      ['page', { page: 0 }],
      ['limit', { limit: 101 }],
      ['q', { q: 'a'.repeat(101) }],
    ])('rejects a bad %s', async (field, query) => {
      const res = await getAs(ownerUser, query);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e) => e.field)).toEqual([field]);
    });

    it('returns every failing field together', async () => {
      const res = await getAs(ownerUser, { section: 'x', limit: 0, sort: 'y' });
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field).sort()).toEqual(['limit', 'section', 'sort']);
    });

    it('ignores unknown params and still applies the known ones', async () => {
      const res = await getAs(ownerUser, {
        section: 'online_coaching',
        limit: 100,
        platform: 'android',
        foo: 'bar',
      });
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(7);
    });

    it('checks the role before the query: a Member with a bad query gets 403', async () => {
      const res = await getAs(memberUser, { section: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('Web and mobile clients', () => {
    it('returns the same status and data with a browser Origin and without one', async () => {
      const web = await request(app)
        .get('/api/v1/plans')
        .set('Authorization', bearerFor(coachUser))
        .set('Origin', 'http://localhost:3000')
        .query({ section: 'online_coaching' });
      const mobile = await request(app)
        .get('/api/v1/plans')
        .set('Authorization', bearerFor(coachUser))
        .set('User-Agent', 'okhttp/4.12.0')
        .query({ section: 'online_coaching' });

      expect(web.status).toBe(200);
      expect(mobile.status).toBe(200);
      expect(mobile.body).toEqual(web.body);
    });
  });

  describe('Rate limiter', () => {
    it('is on the GET route, ahead of validation', () => {
      const layer = planRoutes.stack.find(
        (item) => item.route?.path === '/' && item.route.methods.get,
      );
      const handlers = layer.route.stack.map((item) => item.handle);
      expect(handlers).toContain(planReadLimiter);
    });

    it('answers 429 TOO_MANY_REQUESTS with the standard envelope when exceeded', async () => {
      const testApp = express();
      testApp.get('/plans', createPlanLimiter({ max: 1, windowMs: 60000 }), (_req, res) =>
        res.status(200).json({ success: true }),
      );
      testApp.use(require('../../src/middlewares/errorHandler.middleware'));

      expect((await request(testApp).get('/plans')).status).toBe(200);
      const limited = await request(testApp).get('/plans');
      expect(limited.status).toBe(429);
      expect(limited.body.success).toBe(false);
      expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('Performance', () => {
    // The dev database is remote: every database round trip costs 200-300 ms of network alone,
    // so wall-clock time cannot be compared with 300 ms directly. The budget is 300 ms of
    // processing plus the measured round-trip time for each sequential database call
    // (sign-in check, then the list: one call for a column sort, two for the name sort).
    // The fastest of several runs is compared, because network jitter only ever adds time.
    const SEQUENTIAL_CALLS = { name: 3, '-price': 2 };

    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

    const timeMs = async (fn) => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    it.each(Object.keys(SEQUENTIAL_CALLS))(
      'lists the full catalogue (60+ plans) within 300 ms plus the network, sort=%s',
      async (sort) => {
        const ping = () => prisma.$queryRaw`SELECT 1`;
        await ping();
        const probes = [];
        for (let probe = 0; probe < 5; probe += 1) probes.push(await timeMs(ping));
        const rtt = median(probes);

        await getAs(ownerUser, { sort, limit: 100 }); // warm up
        const timings = [];
        for (let run = 0; run < 7; run += 1) {
          let res;
          timings.push(
            await timeMs(async () => (res = await getAs(ownerUser, { sort, limit: 100 }))),
          );
          expect(res.status).toBe(200);
          expect(res.body.pagination.total).toBeGreaterThanOrEqual(60);
        }

        const budget = 300 + SEQUENTIAL_CALLS[sort] * rtt;
        // eslint-disable-next-line no-console
        console.info(
          `GET /api/v1/plans sort=${sort}: fastest ${Math.min(...timings).toFixed(0)} ms, median ${median(timings).toFixed(0)} ms, ` +
            `round trip ${rtt.toFixed(0)} ms, budget ${budget.toFixed(0)} ms`,
        );
        expect(Math.min(...timings)).toBeLessThan(budget);
      },
    );
  });
});
