const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestClasses,
  createTestClass,
  createTestSession,
  linkTestClassPlan,
} = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('PATCH /api/v1/classes/:id', () => {
  const PREFIX = 'test_slcls_update_';
  const testData = createTestData('slcls_update');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let plan;
  let targetClass;
  let inactiveClass;
  let nullIntensityClass;
  let privateClassNoPlans;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN });
    ownerUser = await testData.createUser({ role: Role.OWNER });
    coachUser = await testData.createUser({ role: Role.COACH });
    memberUser = await testData.createUser({ role: Role.MEMBER });

    plan = await createTestPlan(PREFIX);

    targetClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Target`,
      durationMin: 60,
      baseCapacity: 20,
      intensity: 3,
      classPassEnabled: true,
      classpassSpots: 5,
      visibility: 'PUBLIC',
      active: true,
    });
    await linkTestClassPlan(targetClass.id, plan.id);

    inactiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Inactive`,
      active: false,
    });

    nullIntensityClass = await createTestClass(PREFIX, {
      name: `${PREFIX}ExistingInt`,
      intensity: 2,
      active: true,
    });
    await linkTestClassPlan(nullIntensityClass.id, plan.id);

    privateClassNoPlans = await createTestClass(PREFIX, {
      name: `${PREFIX}PrivateZeroPlans`,
      visibility: 'PRIVATE',
      active: true,
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .send({ durationMin: 90 });
      expect(res.status).toBe(401);
    });

    it.each(['coachUser', 'memberUser'])('returns 403 for %s', async (userKey) => {
      const user = userKey === 'coachUser' ? coachUser : memberUser;
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(user))
        .send({ durationMin: 90 });
      expect(res.status).toBe(403);
    });

    it('allows update by ownerUser', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(ownerUser))
        .send({ description: 'Updated by owner' });
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Updated by owner');
    });
  });

  describe('Validation & Endpoint Rules', () => {
    it('returns 400 for empty update body', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when trying to update eligiblePlanIds', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ eligiblePlanIds: [plan.id] });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('eligiblePlanIds');
    });

    it('returns 400 when trying to update active', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ active: false });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('active');
    });

    it('returns 400 when trying to update non-editable or unknown field', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ externalRef: 'ext-123' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('externalRef');
    });

    it('returns 400 when intensity is explicitly null or 0', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ intensity: null });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ intensity: 0 });
      expect(res2.status).toBe(400);
    });

    it('leaves intensity unchanged when omitted in PATCH', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${nullIntensityClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'Updated existing intensity class' });

      expect(res.status).toBe(200);
      expect(res.body.data.intensity).toBe(2);
      expect(res.body.data.description).toBe('Updated existing intensity class');
    });

    it('returns 400 when merged classpassSpots > baseCapacity', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ baseCapacity: 10, classpassSpots: 15 });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('classpassSpots');
    });

    it('returns 400 when classPassEnabled=false but classpassSpots > 0', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ classPassEnabled: false, classpassSpots: 3 });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('classpassSpots');
    });

    it('returns 400 when private class with 0 plans changes visibility to public', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${privateClassNoPlans.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ visibility: 'public' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('visibility');
    });
  });

  describe('Business Rules & Sessions', () => {
    it('skips session capacity propagation when capacity is in overriddenFields', async () => {
      const classForSession = await createTestClass(PREFIX, {
        name: `${PREFIX}CapacityCheck_${Date.now()}`,
        baseCapacity: 25,
      });
      await linkTestClassPlan(classForSession.id, plan.id);

      const session = await createTestSession(classForSession.id, {
        capacity: 25,
        overriddenFields: ['capacity'],
      });
      expect(session.capacity).toBe(25);

      const res = await request(app)
        .patch(`/api/v1/classes/${classForSession.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ baseCapacity: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.baseCapacity).toBe(10);

      const sessionAfter = await prisma.classSession.findUnique({ where: { id: session.id } });
      expect(sessionAfter.capacity).toBe(25);
    });

    it('returns 409 CLASS_INACTIVE when attempting to PATCH an inactive class', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${inactiveClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'Cannot change' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_INACTIVE');
    });

    it('returns 409 CLASS_DUPLICATE_NAME on rename to existing active class', async () => {
      const existing = await createTestClass(PREFIX, { name: `${PREFIX}CollisionName` });
      await linkTestClassPlan(existing.id, plan.id);

      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ name: existing.name.toUpperCase() });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_DUPLICATE_NAME');
    });
  });

  describe('Concurrency & Optimistic Locking', () => {
    it('returns 409 CLASS_VERSION_CONFLICT when stale version is passed', async () => {
      const current = await prisma.class.findUnique({ where: { id: targetClass.id } });
      const staleVersion = current.version - 1 || 999;

      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'Conflicted update', version: staleVersion });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_VERSION_CONFLICT');
    });

    it('succeeds and bumps version when matching version is passed', async () => {
      const current = await prisma.class.findUnique({ where: { id: targetClass.id } });

      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: `Updated at ${Date.now()}`, version: current.version });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(current.version + 1);
    });

    it('succeeds with last-write-wins when version is omitted', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${targetClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'Last write wins' });

      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Last write wins');
    });
  });
});
