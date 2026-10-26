const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('Class Activate, Archive, and Deactivate State Matrix', () => {
  const PREFIX = 'test_slcls_actarc_';
  const testData = createTestData('slcls_actarc');
  let app;
  let adminUser;
  let ownerUser;
  let memberUser;
  let plan;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
    await testData.cleanup();
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN });
    ownerUser = await testData.createUser({ role: Role.OWNER });
    memberUser = await testData.createUser({ role: Role.MEMBER });
    plan = await createTestPlan(PREFIX);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('State Transitions & Idempotency', () => {
    it('handles ACTIVE -> DEACTIVATED -> ACTIVE lifecycle', async () => {
      const cls = await createTestClass(PREFIX, { name: `${PREFIX}Life1` });
      await prisma.classEligiblePlan.create({ data: { classId: cls.id, planId: plan.id } });

      // 1. Deactivate
      const resDeact = await request(app)
        .post(`/api/v1/classes/${cls.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));
      expect(resDeact.status).toBe(200);
      expect(resDeact.body.data).toEqual({
        id: cls.id,
        status: 'deactivated',
        active: false,
      });

      const inDb1 = await prisma.class.findUnique({ where: { id: cls.id } });
      expect(inDb1.status).toBe('DEACTIVATED');

      // 2. Activate
      const resAct = await request(app)
        .post(`/api/v1/classes/${cls.id}/activate`)
        .set('Authorization', bearerFor(adminUser));
      expect(resAct.status).toBe(200);
      expect(resAct.body.data).toEqual({
        id: cls.id,
        status: 'active',
        active: true,
      });

      const inDb2 = await prisma.class.findUnique({ where: { id: cls.id } });
      expect(inDb2.status).toBe('ACTIVE');

      // 3. Idempotent Activate
      const resAct2 = await request(app)
        .post(`/api/v1/classes/${cls.id}/activate`)
        .set('Authorization', bearerFor(ownerUser));
      expect(resAct2.status).toBe(200);
      expect(resAct2.body.data).toEqual({
        id: cls.id,
        status: 'active',
        active: true,
      });
    });

    it('handles ACTIVE -> ARCHIVED -> ACTIVE lifecycle', async () => {
      const cls = await createTestClass(PREFIX, { name: `${PREFIX}Life2` });
      await prisma.classEligiblePlan.create({ data: { classId: cls.id, planId: plan.id } });

      // 1. Archive
      const resArchive = await request(app)
        .post(`/api/v1/classes/${cls.id}/archive`)
        .set('Authorization', bearerFor(adminUser));
      expect(resArchive.status).toBe(200);
      expect(resArchive.body.data).toEqual({
        id: cls.id,
        status: 'archived',
        active: false,
      });

      const inDb1 = await prisma.class.findUnique({ where: { id: cls.id } });
      expect(inDb1.status).toBe('ARCHIVED');

      // 2. Idempotent Archive
      const resArchive2 = await request(app)
        .post(`/api/v1/classes/${cls.id}/archive`)
        .set('Authorization', bearerFor(ownerUser));
      expect(resArchive2.status).toBe(200);
      expect(resArchive2.body.data).toEqual({
        id: cls.id,
        status: 'archived',
        active: false,
      });

      // 3. Activate from ARCHIVED
      const resAct = await request(app)
        .post(`/api/v1/classes/${cls.id}/activate`)
        .set('Authorization', bearerFor(adminUser));
      expect(resAct.status).toBe(200);
      expect(resAct.body.data).toEqual({
        id: cls.id,
        status: 'active',
        active: true,
      });

      const inDb2 = await prisma.class.findUnique({ where: { id: cls.id } });
      expect(inDb2.status).toBe('ACTIVE');
    });

    it('handles DEACTIVATED -> ARCHIVED transition', async () => {
      const cls = await createTestClass(PREFIX, {
        name: `${PREFIX}Life3`,
        status: 'DEACTIVATED',
      });
      await prisma.classEligiblePlan.create({ data: { classId: cls.id, planId: plan.id } });

      const res = await request(app)
        .post(`/api/v1/classes/${cls.id}/archive`)
        .set('Authorization', bearerFor(adminUser));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: cls.id,
        status: 'archived',
        active: false,
      });

      const inDb = await prisma.class.findUnique({ where: { id: cls.id } });
      expect(inDb.status).toBe('ARCHIVED');
    });
  });

  describe('Name Collision on Restoration', () => {
    it('returns 409 CLASS_DUPLICATE_NAME when deactivated name was reused by an active class and restoration is attempted', async () => {
      const sharedName = `${PREFIX}RestorationRace_${Date.now()}`;

      // 1. Create Class A with sharedName, then deactivate it
      const classA = await createTestClass(PREFIX, { name: sharedName, status: 'ACTIVE' });
      await prisma.classEligiblePlan.create({ data: { classId: classA.id, planId: plan.id } });

      const deactA = await request(app)
        .post(`/api/v1/classes/${classA.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));
      expect(deactA.status).toBe(200);

      // 2. Create Class B with the same name (allowed because Class A is DEACTIVATED)
      const resB = await request(app)
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send({
          name: sharedName,
          durationMin: 60,
          baseCapacity: 15,
          classType: 'onsite',
          intensity: 3,
          visibility: 'public',
          classPassEnabled: false,
          classpassSpots: 0,
          eligiblePlanIds: [plan.id],
        });
      expect(resB.status).toBe(201);
      expect(resB.body.data.status).toBe('active');

      // 3. Attempting to activate Class A must fail with 409 CLASS_DUPLICATE_NAME
      const resActA = await request(app)
        .post(`/api/v1/classes/${classA.id}/activate`)
        .set('Authorization', bearerFor(adminUser));
      expect(resActA.status).toBe(409);
      expect(resActA.body.code).toBe('CLASS_DUPLICATE_NAME');

      // Class A remains DEACTIVATED
      const checkA = await prisma.class.findUnique({ where: { id: classA.id } });
      expect(checkA.status).toBe('DEACTIVATED');
    });
  });

  describe('Archived Class Restrictions & Visibility', () => {
    let archivedClass;

    beforeAll(async () => {
      archivedClass = await createTestClass(PREFIX, {
        name: `${PREFIX}ArchivedRestrictions`,
        status: 'ARCHIVED',
      });
      await prisma.classEligiblePlan.create({
        data: { classId: archivedClass.id, planId: plan.id },
      });
    });

    it('returns 409 CLASS_INACTIVE when attempting to PATCH an archived class', async () => {
      const res = await request(app)
        .patch(`/api/v1/classes/${archivedClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'New description' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_INACTIVE');
    });

    it('returns 409 CLASS_INACTIVE when attempting to PUT eligibility on an archived class', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${archivedClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [plan.id] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_INACTIVE');
    });

    it('member gets 404 on archived class', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${archivedClass.id}`)
        .set('Authorization', bearerFor(memberUser));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });

    it('staff default list excludes archived classes, while status=all includes them', async () => {
      // Default list (no status filter)
      const resDefault = await request(app)
        .get('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser));
      expect(resDefault.status).toBe(200);
      const defaultIds = resDefault.body.data.map((c) => c.id);
      expect(defaultIds).not.toContain(archivedClass.id);

      // status=archived
      const resArchivedOnly = await request(app)
        .get('/api/v1/classes?status=archived')
        .set('Authorization', bearerFor(adminUser));
      expect(resArchivedOnly.status).toBe(200);
      const archivedIds = resArchivedOnly.body.data.map((c) => c.id);
      expect(archivedIds).toContain(archivedClass.id);

      // status=all
      const resAll = await request(app)
        .get('/api/v1/classes?status=all')
        .set('Authorization', bearerFor(adminUser));
      expect(resAll.status).toBe(200);
      const allIds = resAll.body.data.map((c) => c.id);
      expect(allIds).toContain(archivedClass.id);
    });
  });
});
