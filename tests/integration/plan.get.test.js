const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const planRoutes = require('../../src/routes/plan.routes');
const { planReadLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestPlans,
  createTestPlan,
  createTestMembership,
  deleteTestMemberships,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('GET /api/v1/plans/:id', () => {
  const PREFIX = 'test_slmp04_get_';
  const testData = createTestData('slmp04_get');
  let app;
  let users;
  let plan;
  let archivedPlan;

  const getAs = (user, id) =>
    request(app).get(`/api/v1/plans/${id}`).set('Authorization', bearerFor(user));

  beforeAll(async () => {
    app = createApp();
    await deleteTestPlans(PREFIX);
    users = {
      owner: await testData.createUser({ role: Role.OWNER }),
      admin: await testData.createUser({ role: Role.ADMIN }),
      coach: await testData.createUser({ role: Role.COACH }),
      member: await testData.createUser({ role: Role.MEMBER }),
    };
    plan = await createTestPlan(PREFIX, { price: 449.5, description: 'A plan' });
    archivedPlan = await createTestPlan(PREFIX, { status: 'ARCHIVED' });
  });

  afterAll(async () => {
    await deleteTestPlans(PREFIX);
    await deleteTestMemberships(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/api/v1/plans/${plan.id}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for a Member', async () => {
    const res = await getAs(users.member, plan.id);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('data');
  });

  it.each(['owner', 'admin', 'coach'])('returns 200 for %s', async (role) => {
    const res = await getAs(users[role], plan.id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns the full record in the SL-MP-02 shape', async () => {
    const res = await getAs(users.owner, plan.id);

    expect(res.body.data).toEqual({
      id: plan.id,
      name: plan.name,
      kind: 'subscription',
      price: 449.5,
      billingCycle: 'month',
      creditType: 'class',
      creditsIncluded: 10,
      creditRefill: 'monthly',
      validityValue: 1,
      validityUnit: 'month',
      startsOn: 'purchase_date',
      oneTimePurchasePerClient: false,
      visibility: 'public',
      status: 'active',
      description: 'A plan',
      version: 1,
      section: 'class_membership',
      creditSummary: '10 class credits a month',
      creditNote: '10 class credits a month',
      activeClientCount: 0,
      membershipId: null,
      membership: null,
      term: null,
      recurring: false,
      periodMonths: null,
      joiningFee: 0,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    });
  });

  it('returns full record with membershipId, nested membership, term, recurring, periodMonths, joiningFee', async () => {
    const mem = await createTestMembership(PREFIX, {
      name: `${PREFIX}LinkedMem_${Date.now()}`,
      description: 'Linked Desc',
    });
    const linkedPlan = await createTestPlan(PREFIX, {
      membershipId: mem.id,
      term: '3 Months',
      recurring: true,
      periodMonths: 3,
      joiningFee: 75,
    });

    const res = await getAs(users.owner, linkedPlan.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: linkedPlan.id,
      membershipId: mem.id,
      membership: {
        id: mem.id,
        name: mem.name,
        description: 'Linked Desc',
      },
      term: '3 Months',
      recurring: true,
      periodMonths: 3,
      joiningFee: 75,
    });
  });

  it('includes archived plans', async () => {
    const res = await getAs(users.coach, archivedPlan.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('archived');
  });

  it('returns a seeded online coaching plan with its section', async () => {
    const seeded = await prisma.membershipPlan.findFirst({ where: { name: 'Nutrition Coaching' } });
    const res = await getAs(users.admin, seeded.id);
    expect(res.body.data).toMatchObject({
      section: 'online_coaching',
      creditType: 'time',
      creditSummary: 'Time-based access',
    });
  });

  it('returns 404 PLAN_NOT_FOUND for an unknown id', async () => {
    const res = await getAs(users.owner, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'PLAN_NOT_FOUND' });
  });

  it('returns 400 VALIDATION_ERROR for an id that is not a UUID', async () => {
    const res = await getAs(users.owner, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors).toEqual([{ field: 'id', message: 'Plan id must be a valid UUID' }]);
  });

  it('checks the role before it looks the plan up: a Member gets 403 even for an unknown id', async () => {
    const res = await getAs(users.member, crypto.randomUUID());
    expect(res.status).toBe(403);
  });

  it('returns the same status and data with a browser Origin and without one', async () => {
    const web = await request(app)
      .get(`/api/v1/plans/${plan.id}`)
      .set('Authorization', bearerFor(users.coach))
      .set('Origin', 'http://localhost:3000');
    const mobile = await request(app)
      .get(`/api/v1/plans/${plan.id}`)
      .set('Authorization', bearerFor(users.coach))
      .set('User-Agent', 'okhttp/4.12.0');

    expect(web.status).toBe(200);
    expect(mobile.body).toEqual(web.body);
  });

  it('has the read rate limiter on the route', () => {
    const layer = planRoutes.stack.find(
      (item) => item.route?.path === '/:id' && item.route.methods.get,
    );
    expect(layer.route.stack.map((item) => item.handle)).toContain(planReadLimiter);
  });
});
