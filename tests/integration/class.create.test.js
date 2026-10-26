const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('POST /api/v1/classes', () => {
  const PREFIX = 'test_slcls_create_';
  const testData = createTestData('slcls_create');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let activePlan;
  let archivedPlan;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Class Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Class Tester' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Class Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Class Tester' });

    activePlan = await createTestPlan(PREFIX, { name: `${PREFIX}Plan_Active` });
    archivedPlan = await createTestPlan(PREFIX, {
      name: `${PREFIX}Plan_Archived`,
      status: 'ARCHIVED',
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const validPayload = (overrides = {}) => ({
    name: `${PREFIX}Class_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    description: 'A test class',
    durationMin: 60,
    baseCapacity: 20,
    intensity: 3,
    visibility: 'public',
    classPassEnabled: true,
    classpassSpots: 4,
    colour: '#112233',
    photoUrl: 'https://example.com/class.png',
    eligiblePlanIds: [activePlan.id],
    ...overrides,
  });

  describe('Authentication & Authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).post('/api/v1/classes').send(validPayload());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with expired token', async () => {
      const expiredToken = jwt.sign(
        { sub: adminUser.id, role: adminUser.role },
        env.JWT_ACCESS_SECRET,
        { expiresIn: -10 },
      );
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send(validPayload());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it.each(['coachUser', 'memberUser'])('returns 403 for %s', async (userKey) => {
      const user = userKey === 'coachUser' ? coachUser : memberUser;
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(user))
        .send(validPayload());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it.each(['adminUser', 'ownerUser'])('returns 201 for %s', async (userKey) => {
      const user = userKey === 'adminUser' ? adminUser : ownerUser;
      const payload = validPayload({ name: `${PREFIX}Success_${userKey}` });
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(user))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.headers.location).toBe(`/api/v1/classes/${res.body.data.id}`);
      expect(res.body.data).toMatchObject({
        name: payload.name,
        durationMin: 60,
        baseCapacity: 20,
        intensity: 3,
        visibility: 'public',
        classpassSpots: 4,
        colour: '#112233',
        photoUrl: 'https://example.com/class.png',
        active: true,
        version: 1,
        eligiblePlanIds: [activePlan.id],
      });
      expect(res.body.data).not.toHaveProperty('externalRef');
    });
  });

  describe('Validation & Business Rules', () => {
    it('returns 422 when public class has no eligible plans', async () => {
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ eligiblePlanIds: [] }));

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].field).toBe('eligiblePlanIds');
    });

    it('returns 201 for private class with empty eligible plans', async () => {
      const payload = validPayload({
        name: `${PREFIX}Private_NoPlans_${Date.now()}`,
        visibility: 'private',
        eligiblePlanIds: [],
      });
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.visibility).toBe('private');
      expect(res.body.data.eligiblePlanIds).toEqual([]);
    });

    it('returns 422 when unknown plan ID is passed', async () => {
      const badId = 'c0000000-0000-4000-8000-000000000099';
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ eligiblePlanIds: [badId] }));

      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('eligiblePlanIds');
    });

    it('returns 422 when archived plan ID is passed', async () => {
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ eligiblePlanIds: [archivedPlan.id] }));

      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('eligiblePlanIds');
    });

    it('returns 422 on boundary violations (intensity 0 or 6, durationMin 14, baseCapacity 0)', async () => {
      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ intensity: 6, durationMin: 14, baseCapacity: 0 }));

      expect(res.status).toBe(422);
      expect(res.body.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Uniqueness & Race Conditions', () => {
    it('returns 409 CLASS_DUPLICATE_NAME if active class exists with same name (case-insensitive)', async () => {
      const name = `${PREFIX}Unique_Test_${Date.now()}`;
      await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ name }));

      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ name: name.toLowerCase() }));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_DUPLICATE_NAME');
    });

    it('allows same name if existing class is inactive', async () => {
      const name = `${PREFIX}Inactive_Collision_${Date.now()}`;
      await createTestClass(PREFIX, { name, active: false });

      const res = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send(validPayload({ name }));

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(name);
    });

    it('parallel create race: exactly one request gets 201, the other gets 409 CLASS_DUPLICATE_NAME', async () => {
      const sharedName = `${PREFIX}Race_${Date.now()}`;
      const payload1 = validPayload({ name: sharedName });
      const payload2 = validPayload({ name: sharedName });

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/classes')
          .set('Authorization', bearerFor(adminUser))
          .send(payload1),
        request(app)
          .post('/api/v1/classes')
          .set('Authorization', bearerFor(adminUser))
          .send(payload2),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.code).toBe('CLASS_DUPLICATE_NAME');
    });
  });
});
