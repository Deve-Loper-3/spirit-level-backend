const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { addDaysToDateStr, getTodayInTimezone } = require('../../src/services/schedule.service');

jest.setTimeout(45000);

describe('BE-SCH-2: Class Slot Endpoints', () => {
  const PREFIX = 'test_slot_';
  const testData = createTestData('slot_test');
  let app;
  let adminUser;
  let ownerUser;
  let memberUser;
  let testClass;
  let privateClass;
  let inactiveClass;
  let seededCoach;
  let todayStr;
  let tomorrowStr;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();

    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Slot Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Slot Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Slot Tester' });

    const coachProfile = await testData.createCoach({
      user: { fullName: 'Slot Coach Alpha' },
    });
    seededCoach = coachProfile.coach;

    todayStr = getTodayInTimezone('Asia/Dubai');
    tomorrowStr = addDaysToDateStr(todayStr, 1);

    testClass = await createTestClass(PREFIX, {
      name: `${PREFIX}ActivePublic`,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      baseCapacity: 16,
      durationMin: 60,
    });

    // Link coach to testClass
    await prisma.classCoach.create({
      data: { classId: testClass.id, coachId: seededCoach.id },
    });

    privateClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Private`,
      visibility: 'PRIVATE',
      status: 'ACTIVE',
    });

    inactiveClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Inactive`,
      visibility: 'PUBLIC',
      status: 'DEACTIVATED',
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/classes/:id/slots', () => {
    it('creates slots with 201, returns saved slots + reconciliation summary', async () => {
      const payload = {
        startDate: tomorrowStr,
        days: [
          {
            dayOfWeek: 1, // Monday
            times: [
              {
                startTime: '09:00',
                endTime: '10:00',
                coachIds: [seededCoach.id],
                capacity: null, // null capacity = class.baseCapacity
              },
            ],
          },
        ],
      };

      const res = await request(app)
        .post(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toHaveLength(1);
      const slot = res.body.data.slots[0];
      expect(slot.dayOfWeek).toBe(1);
      expect(slot.startTime).toBe('09:00');
      expect(slot.endTime).toBe('10:00');
      expect(slot.capacity).toBeNull();
      expect(slot.active).toBe(true);
      expect(slot.coaches).toHaveLength(1);
      expect(slot.coaches[0].id).toBe(seededCoach.id);
      expect(res.body.data.reconciliation).toBeDefined();
      expect(res.body.data.reconciliation.windowDays).toBe(21);
    });

    it('rejects duplicate active slot for same class, day, and time with 409 SLOT_CONFLICT', async () => {
      const duplicatePayload = {
        startDate: tomorrowStr,
        days: [
          {
            dayOfWeek: 1,
            times: [{ startTime: '09:00', endTime: '10:00' }],
          },
        ],
      };

      const res = await request(app)
        .post(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(adminUser))
        .send(duplicatePayload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('SLOT_CONFLICT');
      expect(res.body.details?.conflicts).toBeDefined();
      expect(res.body.details.conflicts[0].type).toBe('SLOT_CONFLICT');
    });

    it('denies MEMBER from creating slots with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(memberUser))
        .send({
          startDate: tomorrowStr,
          days: [{ dayOfWeek: 3, times: [{ startTime: '11:00', endTime: '12:00' }] }],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/classes/:id/slots', () => {
    it('returns exact persisted values (null capacity remains null)', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const slot = res.body.data.find((s) => s.dayOfWeek === 1 && s.startTime === '09:00');
      expect(slot).toBeDefined();
      expect(slot.capacity).toBeNull();
      expect(slot.active).toBe(true);
    });

    it('hides the slots of a private class from a MEMBER: 404 CLASS_NOT_FOUND', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${privateClass.id}/slots`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });

    it('hides the slots of an inactive class from a MEMBER: 404 CLASS_NOT_FOUND', async () => {
      const res = await request(app)
        .get(`/api/v1/classes/${inactiveClass.id}/slots`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CLASS_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/classes/:id/slots/:slotId', () => {
    it('updates slot and triggers reconciliation', async () => {
      // Create a slot to update
      const createRes = await request(app)
        .post(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(ownerUser))
        .send({
          startDate: tomorrowStr,
          days: [
            {
              dayOfWeek: 4, // Thursday
              times: [{ startTime: '14:00', endTime: '15:00', capacity: 10 }],
            },
          ],
        });

      const slotId = createRes.body.data.slots[0].id;

      const patchRes = await request(app)
        .patch(`/api/v1/classes/${testClass.id}/slots/${slotId}`)
        .set('Authorization', bearerFor(adminUser))
        .send({
          capacity: 14,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data.capacity).toBe(14);
    });
  });

  describe('DELETE /api/v1/classes/:id/slots/:slotId', () => {
    it('soft-deactivates the slot and removes future unbooked non-overridden generated sessions', async () => {
      const createRes = await request(app)
        .post(`/api/v1/classes/${testClass.id}/slots`)
        .set('Authorization', bearerFor(ownerUser))
        .send({
          startDate: tomorrowStr,
          days: [
            {
              dayOfWeek: 5, // Friday
              times: [{ startTime: '16:00', endTime: '17:00', capacity: 8 }],
            },
          ],
        });

      const slotId = createRes.body.data.slots[0].id;

      // Ensure generated sessions exist for this slot
      const initialSessions = await prisma.classSession.findMany({
        where: { slotId, source: 'GENERATED' },
      });
      expect(initialSessions.length).toBeGreaterThan(0);

      // Now soft-delete
      const deleteRes = await request(app)
        .delete(`/api/v1/classes/${testClass.id}/slots/${slotId}`)
        .set('Authorization', bearerFor(adminUser));

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data.active).toBe(false);

      // Verify slot in DB is active = false
      const dbSlot = await prisma.classSlot.findUnique({ where: { id: slotId } });
      expect(dbSlot.active).toBe(false);

      // Verify unbooked non-overridden sessions were deleted
      const remainingSessions = await prisma.classSession.findMany({
        where: { slotId, source: 'GENERATED' },
      });
      expect(remainingSessions).toHaveLength(0);
    });
  });
});
