const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestMemberships,
  deleteTestPlans,
  createTestMembership,
  createTestPlan,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(35000);

describe('GET /api/v1/memberships', () => {
  const TEST_PREFIX = 'test_mem_list_';
  const testData = createTestData('mem_list');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let testMembership;

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
    await deleteTestMemberships(TEST_PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Tester' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Tester' });

    testMembership = await createTestMembership(TEST_PREFIX, {
      name: `${TEST_PREFIX}Cluster_${Date.now()}`,
      description: 'Test Cluster Description',
    });

    // Create 2 plans linked to this membership
    await createTestPlan(TEST_PREFIX, {
      membershipId: testMembership.id,
      name: `${TEST_PREFIX}PlanA_${Date.now()}`,
      price: 250,
      term: '6 Months',
      recurring: true,
      periodMonths: 6,
      joiningFee: 50,
    });
    await createTestPlan(TEST_PREFIX, {
      membershipId: testMembership.id,
      name: `${TEST_PREFIX}PlanB_${Date.now()}`,
      price: 350,
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const getMemberships = ({ token = bearerFor(adminUser), origin, query = {} } = {}) => {
    const req = request(app).get('/api/v1/memberships').query(query);
    if (token) req.set('Authorization', token);
    if (origin) req.set('Origin', origin);
    return req;
  };

  // The list is paged (and the shared test database may hold many memberships), so walk the pages.
  const findInAllPages = async (id) => {
    for (let page = 1; ; page += 1) {
      const res = await getMemberships({ query: { page, limit: 100 } });
      const found = res.body.data.find((m) => m.id === id);
      if (found || page >= res.body.pagination.totalPages) return found;
    }
  };

  describe('Success & Shape', () => {
    it('returns 200 with memberships list, exact planCount, and mapped plans', async () => {
      const res = await getMemberships();
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const found = await findInAllPages(testMembership.id);
      expect(found).toBeDefined();
      expect(found).toMatchObject({
        id: testMembership.id,
        name: testMembership.name,
        description: 'Test Cluster Description',
        planCount: 2,
      });
      expect(found.createdAt).toBeDefined();
      expect(found.plans).toHaveLength(2);

      const planA = found.plans.find((p) => p.name.includes('PlanA'));
      expect(planA).toBeDefined();
      expect(planA.membershipId).toBe(testMembership.id);
      expect(planA.membership).toEqual({
        id: testMembership.id,
        name: testMembership.name,
        description: 'Test Cluster Description',
      });
      expect(typeof planA.price).toBe('number');
      expect(planA.price).toBe(250);
      expect(planA.section).toBe('class_membership');
      expect(planA.term).toBe('6 Months');
      expect(planA.recurring).toBe(true);
      expect(planA.periodMonths).toBe(6);
      expect(planA.joiningFee).toBe(50);
      expect(planA.creditSummary).toBeDefined();
    });

    it('allows OWNER and COACH to read memberships', async () => {
      const ownerRes = await getMemberships({ token: bearerFor(ownerUser) });
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.success).toBe(true);

      const coachRes = await getMemberships({ token: bearerFor(coachUser) });
      expect(coachRes.status).toBe(200);
      expect(coachRes.body.success).toBe(true);
    });
  });

  describe('Pagination', () => {
    it('answers with the shared pagination shape and the default page and limit', async () => {
      const res = await getMemberships();

      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: Math.ceil(res.body.pagination.total / 20),
      });
      expect(res.body.data.length).toBeLessThanOrEqual(20);
      expect(res.body).not.toHaveProperty('meta');
    });

    it('limit 1 returns one membership, and the next page returns a different one', async () => {
      const first = await getMemberships({ query: { page: 1, limit: 1 } });
      const second = await getMemberships({ query: { page: 2, limit: 1 } });

      expect(first.body.data).toHaveLength(1);
      expect(second.body.data).toHaveLength(1);
      expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
      expect(first.body.pagination.total).toBeGreaterThanOrEqual(2);
      expect(first.body.pagination.totalPages).toBe(first.body.pagination.total);
    });

    it('a page past the end is 200 with an empty list', async () => {
      const res = await getMemberships({ query: { page: 99999, limit: 100 } });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it.each([
      ['page 0', { page: 0 }, 'page'],
      ['page abc', { page: 'abc' }, 'page'],
      ['limit 0', { limit: 0 }, 'limit'],
      ['limit 101', { limit: 101 }, 'limit'],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_label, query, field) => {
      const res = await getMemberships({ query });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    it('ignores unknown query parameters', async () => {
      const res = await getMemberships({ query: { foo: 'bar' } });
      expect(res.status).toBe(200);
    });

    it('planCount counts all plans of the membership, not only the loaded ones', async () => {
      const found = await findInAllPages(testMembership.id);
      expect(found.planCount).toBe(2);
      expect(found.plans).toHaveLength(found.planCount);
    });
  });

  describe('RBAC', () => {
    it('forbids MEMBER with 403', async () => {
      const res = await getMemberships({ token: bearerFor(memberUser) });
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated caller with 401', async () => {
      const res = await getMemberships({ token: null });
      expect(res.status).toBe(401);
    });
  });

  describe('Parity: Browser Origin vs Kotlin no-Origin', () => {
    it('works identically with browser Origin header and without Origin header', async () => {
      const webRes = await getMemberships({ origin: 'http://localhost:3000' });
      expect(webRes.status).toBe(200);

      const mobileRes = await getMemberships({ origin: undefined });
      expect(mobileRes.status).toBe(200);
    });
  });
});
