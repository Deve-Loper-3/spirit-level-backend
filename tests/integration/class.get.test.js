const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestClasses,
  createTestClass,
  linkTestClassPlan,
  linkTestClassCoach,
} = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('GET /api/v1/classes & GET /api/v1/classes/:id', () => {
  const PREFIX = 'test_slcls_get_';
  const testData = createTestData('slcls_get');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let coachProfile;
  let plan;
  let publicActiveClass;
  let privateActiveClass;
  let inactiveClass;
  let nullIntensityClass;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN });
    ownerUser = await testData.createUser({ role: Role.OWNER });
    const coachAccount = await testData.createCoach({ bio: 'Top coach' });
    coachUser = coachAccount.user;
    coachProfile = coachAccount.coach;
    memberUser = await testData.createUser({ role: Role.MEMBER });

    plan = await createTestPlan(PREFIX);

    // 1. Public active class
    publicActiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}PublicActive`,
      visibility: 'PUBLIC',
      active: true,
      intensity: 3,
    });
    await linkTestClassPlan(publicActiveClass.id, plan.id);
    await linkTestClassCoach(publicActiveClass.id, coachProfile.id);

    // 2. Private active class assigned to coach
    privateActiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}PrivateAssigned`,
      visibility: 'PRIVATE',
      active: true,
      intensity: 4,
    });
    await linkTestClassCoach(privateActiveClass.id, coachProfile.id);

    // 3. Inactive public class
    inactiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}InactivePublic`,
      visibility: 'PUBLIC',
      active: false,
      intensity: 2,
    });

    // 4. Class with intensity 3
    nullIntensityClass = await createTestClass(PREFIX, {
      name: `${PREFIX}SeededIntensity`,
      visibility: 'PUBLIC',
      active: true,
      intensity: 3,
    });
    await linkTestClassPlan(nullIntensityClass.id, plan.id);
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/classes/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).get(`/api/v1/classes/${publicActiveClass.id}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 for unknown UUID', async () => {
      const unknownId = 'a0000000-0000-4000-8000-000000000099';
      const res = await request(app)
        .get(`/api/v1/classes/${unknownId}`)
        .set('Authorization', bearerFor(adminUser));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });

    it.each(['adminUser', 'ownerUser', 'coachUser', 'memberUser'])(
      'returns 200 for %s on active public class',
      async (userKey) => {
        const user = { adminUser, ownerUser, coachUser, memberUser }[userKey];
        const res = await request(app)
          .get(`/api/v1/classes/${publicActiveClass.id}`)
          .set('Authorization', bearerFor(user));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
          id: publicActiveClass.id,
          name: publicActiveClass.name,
          intensity: 3,
          visibility: 'public',
          active: true,
          eligiblePlanIds: [plan.id],
        });
        expect(res.body.data.coaches).toEqual([
          expect.objectContaining({
            id: coachProfile.id,
            fullName: coachUser.fullName,
          }),
        ]);
        expect(res.body.data).not.toHaveProperty('externalRef');
      },
    );

    it('returns intensity: 3 for class with intensity', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${nullIntensityClass.id}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.intensity).toBe(3);
    });

    it('member gets 404 on private class', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${privateActiveClass.id}`)
        .set('Authorization', bearerFor(memberUser));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });

    it('member gets 404 on inactive class', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${inactiveClass.id}`)
        .set('Authorization', bearerFor(memberUser));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });

    it('coach sees assigned private class', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${privateActiveClass.id}`)
        .set('Authorization', bearerFor(coachUser));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(privateActiveClass.id);
    });

    it('admin sees inactive class', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${inactiveClass.id}`)
        .set('Authorization', bearerFor(adminUser));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(inactiveClass.id);
    });
  });

  describe('GET /api/v1/classes', () => {
    it('member only sees active public classes', async () => {
      const res = await request(app)
        .get('/api/v1/classes')
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.data.every((c) => c.active === true && c.visibility === 'public')).toBe(true);
      const ids = res.body.data.map((c) => c.id);
      expect(ids).toContain(publicActiveClass.id);
      expect(ids).not.toContain(privateActiveClass.id);
      expect(ids).not.toContain(inactiveClass.id);
    });

    it('admin with active=false sees inactive classes', async () => {
      const res = await request(app)
        .get('/api/v1/classes?active=false')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      const ids = res.body.data.map((c) => c.id);
      expect(ids).toContain(inactiveClass.id);
      expect(ids).not.toContain(publicActiveClass.id);
    });

    it('admin with active=all sees active and inactive classes', async () => {
      const res = await request(app)
        .get('/api/v1/classes?active=all')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      const ids = res.body.data.map((c) => c.id);
      expect(ids).toContain(publicActiveClass.id);
      expect(ids).toContain(inactiveClass.id);
    });

    it('filters by visibility=private', async () => {
      const res = await request(app)
        .get('/api/v1/classes?visibility=private')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.every((c) => c.visibility === 'private')).toBe(true);
      const ids = res.body.data.map((c) => c.id);
      expect(ids).toContain(privateActiveClass.id);
    });

    it('includes pagination meta in response', async () => {
      const res = await request(app)
        .get('/api/v1/classes?page=1&pageSize=10')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({
        page: 1,
        pageSize: 10,
        total: expect.any(Number),
      });
    });
  });
});
