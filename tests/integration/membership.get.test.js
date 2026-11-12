const crypto = require('crypto');
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

describe('GET /api/v1/memberships/:id', () => {
  const PREFIX = 'test_mem_get_';
  const testData = createTestData('mem_get');
  let app;
  let users;
  let membership;
  let emptyMembership;

  const cleanup = async () => {
    await deleteTestPlans(PREFIX);
    await deleteTestMemberships(PREFIX);
  };

  const getById = (id, { token = bearerFor(users.admin), origin } = {}) => {
    const req = request(app).get(`/api/v1/memberships/${id}`);
    if (token) req.set('Authorization', token);
    if (origin) req.set('Origin', origin);
    return req;
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    users = {
      owner: await testData.createUser({ role: Role.OWNER }),
      admin: await testData.createUser({ role: Role.ADMIN }),
      coach: await testData.createUser({ role: Role.COACH }),
      member: await testData.createUser({ role: Role.MEMBER }),
    };
    membership = await createTestMembership(PREFIX, { description: 'Gold tier' });
    emptyMembership = await createTestMembership(PREFIX);
    await createTestPlan(PREFIX, {
      membershipId: membership.id,
      price: 250,
      term: '6 Months',
      recurring: true,
      periodMonths: 6,
      joiningFee: 50,
    });
    await createTestPlan(PREFIX, { membershipId: membership.id, price: 350 });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Success', () => {
    it('returns the membership with planCount and its plans in the full plan view', async () => {
      const res = await getById(membership.id);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: membership.id,
        name: membership.name,
        description: 'Gold tier',
        planCount: 2,
      });
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.plans).toHaveLength(2);
      const priced = res.body.data.plans.find((plan) => plan.price === 250);
      expect(priced).toMatchObject({
        membershipId: membership.id,
        membership: { id: membership.id, name: membership.name, description: 'Gold tier' },
        term: '6 Months',
        recurring: true,
        periodMonths: 6,
        joiningFee: 50,
      });
      expect(priced).not.toHaveProperty('creditNote');
    });

    it('returns an empty plan list and planCount 0 for a membership without plans', async () => {
      const res = await getById(emptyMembership.id);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: emptyMembership.id, planCount: 0, plans: [] });
    });

    it('has exactly the keys of a list item and the same content for the same membership', async () => {
      const byId = await getById(membership.id);
      const list = await request(app)
        .get('/api/v1/memberships')
        .query({ limit: 100 })
        .set('Authorization', bearerFor(users.admin));

      expect(Object.keys(byId.body.data).sort()).toEqual(
        ['createdAt', 'description', 'id', 'name', 'planCount', 'plans'].sort(),
      );
      const item = list.body.data.find((m) => m.id === membership.id);
      // The shared test database may hold more than 100 memberships; compare when it is on page 1.
      if (item) expect(item).toEqual(byId.body.data);
    });

    it('planCount follows the database', async () => {
      const extra = await createTestMembership(PREFIX);
      await createTestPlan(PREFIX, { membershipId: extra.id });

      const res = await getById(extra.id);

      expect(res.body.data.planCount).toBe(1);
      expect(res.body.data.plans).toHaveLength(1);
    });
  });

  describe('Errors', () => {
    it('returns 404 MEMBERSHIP_NOT_FOUND for an unknown UUID', async () => {
      const res = await getById(crypto.randomUUID());

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    });

    it('returns 400 VALIDATION_ERROR for an id that is not a UUID', async () => {
      const res = await getById('not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toEqual([
        { field: 'id', message: 'Membership ID must be a valid UUID' },
      ]);
    });
  });

  describe('RBAC', () => {
    it.each([
      ['OWNER', 'owner'],
      ['ADMIN', 'admin'],
      ['COACH', 'coach'],
    ])('allows %s', async (_label, key) => {
      const res = await getById(membership.id, { token: bearerFor(users[key]) });
      expect(res.status).toBe(200);
    });

    it('forbids MEMBER with 403', async () => {
      const res = await getById(membership.id, { token: bearerFor(users.member) });
      expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated caller with 401', async () => {
      const res = await getById(membership.id, { token: null });
      expect(res.status).toBe(401);
    });

    it('checks the role before the id (a MEMBER with a bad id still gets 403)', async () => {
      const res = await getById('not-a-uuid', { token: bearerFor(users.member) });
      expect(res.status).toBe(403);
    });
  });

  describe('Methods and parity', () => {
    it.each(['post', 'put', 'patch', 'delete'])(
      '%s answers 405 with Allow: GET',
      async (method) => {
        const res = await request(app)
          [method](`/api/v1/memberships/${membership.id}`)
          .set('Authorization', bearerFor(users.admin))
          .send({});

        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('GET');
        expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      },
    );

    it('works the same with a browser Origin header and without one (Kotlin)', async () => {
      const web = await getById(membership.id, { origin: 'http://localhost:3000' });
      const mobile = await getById(membership.id);

      expect(web.status).toBe(200);
      expect(mobile.status).toBe(200);
      expect(web.body.data).toEqual(mobile.body.data);
    });
  });
});
