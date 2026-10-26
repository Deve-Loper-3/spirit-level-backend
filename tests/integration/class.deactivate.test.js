const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const repository = require('../../src/repositories/class.repository');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestClasses,
  createTestClass,
  createTestSlot,
  createTestSession,
} = require('../helpers/class.helper');
const { deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('POST /api/v1/classes/:id/deactivate', () => {
  const PREFIX = 'test_slcls_deact_';
  const testData = createTestData('slcls_deact');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let activeClass;
  let classWithZeroPlans;

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

    activeClass = await createTestClass(PREFIX, {
      name: `${PREFIX}ActiveToDeact`,
      active: true,
    });
    await createTestSlot(activeClass.id);
    await createTestSession(activeClass.id);

    classWithZeroPlans = await createTestClass(PREFIX, {
      name: `${PREFIX}ZeroPlansPublic`,
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
      const res = await request(app).post(`/api/v1/classes/${activeClass.id}/deactivate`);
      expect(res.status).toBe(401);
    });

    it.each(['coachUser', 'memberUser'])('returns 403 for %s', async (userKey) => {
      const user = userKey === 'coachUser' ? coachUser : memberUser;
      const res = await request(app)
        .post(`/api/v1/classes/${activeClass.id}/deactivate`)
        .set('Authorization', bearerFor(user));
      expect(res.status).toBe(403);
    });

    it('returns 404 for unknown ID', async () => {
      const unknownId = 'd0000000-0000-4000-8000-000000000099';
      const res = await request(app)
        .post(`/api/v1/classes/${unknownId}/deactivate`)
        .set('Authorization', bearerFor(adminUser));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });
  });

  describe('Deactivation Logic', () => {
    it('returns 409 CLASS_HAS_FUTURE_BOOKINGS with details.sessionCount when future bookings exist', async () => {
      const spy = jest.spyOn(repository, 'countFutureBookedSessions').mockResolvedValueOnce(3);

      const res = await request(app)
        .post(`/api/v1/classes/${activeClass.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLASS_HAS_FUTURE_BOOKINGS');
      expect(res.body.details).toEqual({ sessionCount: 3 });

      const check = await prisma.class.findUnique({ where: { id: activeClass.id } });
      expect(check.status).toBe('ACTIVE');

      spy.mockRestore();
    });

    it('successfully deactivates class with 0 future bookings, keeping slots & sessions', async () => {
      const res = await request(app)
        .post(`/api/v1/classes/${activeClass.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: activeClass.id,
        status: 'deactivated',
        active: false,
      });

      const inDb = await prisma.class.findUnique({ where: { id: activeClass.id } });
      expect(inDb.status).toBe('DEACTIVATED');

      const slotsCount = await prisma.classSlot.count({ where: { classId: activeClass.id } });
      expect(slotsCount).toBeGreaterThan(0);
      const sessionsCount = await prisma.classSession.count({ where: { classId: activeClass.id } });
      expect(sessionsCount).toBeGreaterThan(0);
    });

    it('is idempotent: deactivating an already deactivated class returns 200 { id, status: "deactivated", active: false }', async () => {
      const res = await request(app)
        .post(`/api/v1/classes/${activeClass.id}/deactivate`)
        .set('Authorization', bearerFor(ownerUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: activeClass.id,
        status: 'deactivated',
        active: false,
      });
    });

    it('always allows deactivation of seeded classes with 0 plans', async () => {
      const res = await request(app)
        .post(`/api/v1/classes/${classWithZeroPlans.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: classWithZeroPlans.id,
        status: 'deactivated',
        active: false,
      });
    });
  });
});
