const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('PUT /api/v1/classes/:id/eligibility', () => {
  const PREFIX = 'test_slcls_elig_';
  const testData = createTestData('slcls_elig');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let planA;
  let planB;
  let kidPlan;
  let archivedPlan;
  let publicClass;
  let privateClass;
  let inactiveClass;
  let kidsClass;

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

    planA = await createTestPlan(PREFIX, { name: `${PREFIX}PlanA` });
    planB = await createTestPlan(PREFIX, { name: `${PREFIX}PlanB` });
    kidPlan = await createTestPlan(PREFIX, { name: `${PREFIX}KidPlan` });
    archivedPlan = await createTestPlan(PREFIX, { name: `${PREFIX}Archived`, status: 'ARCHIVED' });

    publicClass = await createTestClass(PREFIX, {
      name: `${PREFIX}PublicClass`,
      visibility: 'PUBLIC',
      active: true,
    });

    privateClass = await createTestClass(PREFIX, {
      name: `${PREFIX}PrivateClass`,
      visibility: 'PRIVATE',
      active: true,
    });

    inactiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}InactiveClass`,
      active: false,
    });

    kidsClass = await createTestClass(PREFIX, {
      name: `${PREFIX}STRDY x ROXSTARS (Kids Class)`,
      visibility: 'PUBLIC',
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
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .send({ planIds: [planA.id] });
      expect(res.status).toBe(401);
    });

    it.each(['coachUser', 'memberUser'])('returns 403 for %s', async (userKey) => {
      const user = userKey === 'coachUser' ? coachUser : memberUser;
      const res = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(user))
        .send({ planIds: [planA.id] });
      expect(res.status).toBe(403);
    });

    it('returns 404 for unknown ID', async () => {
      const unknownId = 'e0000000-0000-4000-8000-000000000099';
      const res = await request(app)
        .put(`/api/v1/classes/${unknownId}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [planA.id] });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });
  });

  describe('Eligibility Replacement & Validation', () => {
    it('returns 409 CLASS_INACTIVE on inactive class', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${inactiveClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [planA.id] });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_INACTIVE');
    });

    it('returns 400 if public class is submitted with empty planIds', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('planIds');
    });

    it('allows private class to be submitted with empty planIds', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${privateClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ classId: privateClass.id, planIds: [] });
    });

    it('returns 400 when unknown plan ID is submitted', async () => {
      const badId = 'e0000000-0000-4000-8000-000000000088';
      const res = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [badId] });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('planIds');
    });

    it('returns 400 when archived plan ID is submitted', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [archivedPlan.id] });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('planIds');
    });

    it('replaces the whole list and deduplicates plan IDs', async () => {
      // First update with planA and planB
      const res1 = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [planA.id, planB.id, planA.id] });

      expect(res1.status).toBe(200);
      expect(res1.body.data.planIds).toEqual([planA.id, planB.id]);

      // Replace completely with only planB
      const res2 = await request(app)
        .put(`/api/v1/classes/${publicClass.id}/eligibility`)
        .set('Authorization', bearerFor(ownerUser))
        .send({ planIds: [planB.id] });

      expect(res2.status).toBe(200);
      expect(res2.body.data.planIds).toEqual([planB.id]);

      const inDb = await prisma.classEligiblePlan.findMany({
        where: { classId: publicClass.id },
      });
      expect(inDb.map((p) => p.planId)).toEqual([planB.id]);
    });

    it('Kids class accepts designated kids plans via the list (no hardcoded restriction in code, BR-14)', async () => {
      const res = await request(app)
        .put(`/api/v1/classes/${kidsClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [kidPlan.id] });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ classId: kidsClass.id, planIds: [kidPlan.id] });
    });

    it('parallel PUT and PATCH: handles concurrent updates without deadlock or corruption', async () => {
      const [putRes, patchRes] = await Promise.all([
        request(app)
          .put(`/api/v1/classes/${publicClass.id}/eligibility`)
          .set('Authorization', bearerFor(adminUser))
          .send({ planIds: [planA.id] }),
        request(app)
          .patch(`/api/v1/classes/${publicClass.id}`)
          .set('Authorization', bearerFor(adminUser))
          .send({ description: 'Concurrent update' }),
      ]);

      expect(putRes.status).toBe(200);
      expect(patchRes.status).toBe(200);
    });

    it('handles parallel PUT eligibility and PATCH visibility=public deterministically', async () => {
      // Setup a private class with 1 plan
      const raceClass = await createTestClass(PREFIX, {
        name: `${PREFIX}RaceClass`,
        visibility: 'PRIVATE',
        active: true,
      });
      await prisma.classEligiblePlan.create({
        data: { classId: raceClass.id, planId: planA.id },
      });

      // Concurrent race: PUT eligibility with [] while PATCH visibility='public'
      const [putRes, patchRes] = await Promise.all([
        request(app)
          .put(`/api/v1/classes/${raceClass.id}/eligibility`)
          .set('Authorization', bearerFor(adminUser))
          .send({ planIds: [] }),
        request(app)
          .patch(`/api/v1/classes/${raceClass.id}`)
          .set('Authorization', bearerFor(adminUser))
          .send({ visibility: 'public' }),
      ]);

      // Both requests finish without crash/deadlock
      expect([200, 400]).toContain(putRes.status);
      expect([200, 400]).toContain(patchRes.status);

      // Invariant: Class in DB must NEVER end up PUBLIC with 0 eligible plans
      const finalClass = await prisma.class.findUnique({
        where: { id: raceClass.id },
        include: { eligiblePlans: true },
      });

      if (finalClass.visibility === 'PUBLIC') {
        expect(finalClass.eligiblePlans.length).toBeGreaterThan(0);
      } else {
        expect(finalClass.visibility).toBe('PRIVATE');
      }
    });
  });
});
