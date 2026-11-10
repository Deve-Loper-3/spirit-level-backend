const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  createTestClass,
  createTestSlot,
  createTestSession,
  linkTestClassCoach,
  deleteTestClasses,
} = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(90000);

const COACHES_URL = '/api/v1/coaches';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const CLASS_PREFIX = `test_coach_avail_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const day = (
  dayOfWeek,
  slots = [{ startTime: '09:00', endTime: '17:00' }],
  isAvailable = true,
) => ({
  dayOfWeek,
  isAvailable,
  slots,
});
const off = (dayOfWeek) => day(dayOfWeek, [], false);

// A valid full week; `overrides` replace days by dayOfWeek.
const week = (...overrides) => ({
  days: [1, 2, 3, 4, 5, 6, 7].map((d) => overrides.find((o) => o.dayOfWeek === d) ?? day(d)),
});

describe('coach weekly availability: GET / PUT /api/v1/coaches/:coachId/availability', () => {
  const testData = createTestData('coach_avail');
  let app;
  let admin;
  let owner;
  let member;
  let alpha; // { user, coach }
  let bravo;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    alpha = await testData.createCoach({ user: { fullName: 'Avail Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Avail Bravo' } });
  });

  afterAll(async () => {
    // class_session_coaches.coachId is RESTRICT: sessions go before the coaches.
    await deleteTestClasses(CLASS_PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const urlOf = (coach) => `${COACHES_URL}/${coach.coach.id}/availability`;
  const get = (caller, url) => request(app).get(url).set('Authorization', bearerFor(caller));
  const put = (caller, url, body) =>
    request(app).put(url).set('Authorization', bearerFor(caller)).send(body);

  const dbSlots = (coachId) =>
    prisma.coachAvailabilitySlot.findMany({
      where: { coachId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  const dbDays = (coachId) => prisma.coachAvailabilityDay.findMany({ where: { coachId } });

  describe('GET', () => {
    it('returns 7 unavailable days, isConfigured false and updatedAt null for a coach with no hours', async () => {
      const res = await get(admin, urlOf(alpha));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.coachId).toBe(alpha.coach.id);
      expect(res.body.data.isConfigured).toBe(false);
      expect(res.body.data.updatedAt).toBeNull();
      expect(typeof res.body.data.timezone).toBe('string');
      expect(res.body.data.days).toEqual(
        [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, isAvailable: false, slots: [] })),
      );
    });

    it('requires a token', async () => {
      const res = await request(app).get(urlOf(alpha));
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('answers 400 for a coach id that is not a UUID', async () => {
      const res = await get(admin, `${COACHES_URL}/not-a-uuid/availability`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('answers 404 COACH_NOT_FOUND for an unknown coach', async () => {
      const res = await get(admin, `${COACHES_URL}/${MISSING_ID}/availability`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('COACH_NOT_FOUND');
    });

    it('answers 405 with Allow: GET, PUT for other methods', async () => {
      for (const method of ['post', 'patch', 'delete']) {
        const res = await request(app)[method](urlOf(alpha)).set('Authorization', bearerFor(admin));
        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('GET, PUT');
        expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      }
    });
  });

  describe('PUT', () => {
    it('saves a week and GET returns exactly what was saved (round trip), slots sorted', async () => {
      const body = week(
        day(1, [
          { startTime: '16:00', endTime: '20:00' },
          { startTime: '06:00', endTime: '12:00' },
        ]),
        off(6),
        off(7),
      );

      const saved = await put(admin, urlOf(alpha), body);
      expect(saved.status).toBe(200);
      expect(saved.body.message).toBe(Messages.COACH_AVAILABILITY_SAVED_SUCCESS);
      expect(saved.body.data.isConfigured).toBe(true);
      expect(saved.body.data.updatedAt).toMatch(ISO_UTC);
      expect(saved.body.data.days[0].slots).toEqual([
        { startTime: '06:00', endTime: '12:00' },
        { startTime: '16:00', endTime: '20:00' },
      ]);
      expect(saved.body.data.days[5]).toEqual({ dayOfWeek: 6, isAvailable: false, slots: [] });

      const read = await get(admin, urlOf(alpha));
      expect(read.status).toBe(200);
      expect(read.body.data).toEqual(saved.body.data);

      expect(await dbDays(alpha.coach.id)).toHaveLength(7);
      expect(await dbSlots(alpha.coach.id)).toHaveLength(2 + 4); // Monday 2, Tuesday-Friday 1 each
    });

    it('lets an OWNER save too', async () => {
      const res = await put(owner, urlOf(bravo), week());
      expect(res.status).toBe(200);
      expect(res.body.data.days).toHaveLength(7);
    });

    it('replaces the whole week: the old days and slots are gone', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Replace' } });
      const url = urlOf(target);

      await put(
        admin,
        url,
        week(
          day(1, [{ startTime: '05:00', endTime: '06:00' }]),
          day(2, [{ startTime: '05:00', endTime: '06:00' }]),
        ),
      );
      const second = week(
        day(1, [{ startTime: '10:00', endTime: '11:00' }]),
        off(2),
        off(3),
        off(4),
        off(5),
        off(6),
        off(7),
      );
      const res = await put(admin, url, second);
      expect(res.status).toBe(200);

      const slots = await dbSlots(target.coach.id);
      expect(slots).toHaveLength(1);
      expect(slots[0].dayOfWeek).toBe(1);
      expect(slots[0].startTime.toISOString().substring(11, 16)).toBe('10:00');
      expect(await dbDays(target.coach.id)).toHaveLength(7);

      const read = await get(admin, url);
      expect(read.body.data.days[0].slots).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
      expect(read.body.data.days[1]).toEqual({ dayOfWeek: 2, isAvailable: false, slots: [] });
    });

    it('accepts a week where every day is unavailable and then reports isConfigured true', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail AllOff' } });
      const res = await put(admin, urlOf(target), { days: [1, 2, 3, 4, 5, 6, 7].map(off) });
      expect(res.status).toBe(200);
      expect(res.body.data.isConfigured).toBe(true);
      expect(res.body.data.days.every((d) => !d.isAvailable && d.slots.length === 0)).toBe(true);
      expect(await dbSlots(target.coach.id)).toHaveLength(0);
    });

    it('allows touching slots (09:00-12:00 and 12:00-15:00)', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Touch' } });
      const res = await put(
        admin,
        urlOf(target),
        week(
          day(3, [
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '12:00', endTime: '15:00' },
          ]),
        ),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.days[2].slots).toEqual([
        { startTime: '09:00', endTime: '12:00' },
        { startTime: '12:00', endTime: '15:00' },
      ]);
    });

    it('rejects overlapping slots with 400, a message naming the day and both slots, and saves nothing', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Overlap' } });
      const url = urlOf(target);
      await put(admin, url, week(off(7)));

      const res = await put(
        admin,
        url,
        week(
          day(3, [
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '11:00', endTime: '14:00' },
          ]),
        ),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors[0].field).toMatch(/^days\.2\.slots\.\d\.startTime$/);
      expect(res.body.errors[0].message).toContain('Wednesday');
      expect(res.body.errors[0].message).toContain('09:00-12:00');
      expect(res.body.errors[0].message).toContain('11:00-14:00');

      // The previous week is still there.
      const read = await get(admin, url);
      expect(read.body.data.days[2].slots).toEqual([{ startTime: '09:00', endTime: '17:00' }]);
      expect(read.body.data.days[6].isAvailable).toBe(false);
    });

    it('rejects 6 days with 400 on the field "days"', async () => {
      const body = { days: week().days.slice(0, 6) };
      const res = await put(admin, urlOf(alpha), body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e) => e.field)).toContain('days');
    });

    it('rejects a duplicate dayOfWeek with 400 on that entry', async () => {
      const body = week();
      body.days[3] = day(3);
      const res = await put(admin, urlOf(alpha), body);
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toContain('days.3.dayOfWeek');
    });

    it('rejects a missing body with 400', async () => {
      const res = await request(app).put(urlOf(alpha)).set('Authorization', bearerFor(admin));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('answers 404 COACH_NOT_FOUND for an unknown coach', async () => {
      const res = await put(admin, `${COACHES_URL}/${MISSING_ID}/availability`, week());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('COACH_NOT_FOUND');
    });

    it('serializes two concurrent saves: both succeed and the result is exactly one of them', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Race' } });
      const url = urlOf(target);
      const one = week(day(1, [{ startTime: '06:00', endTime: '07:00' }]));
      const two = week(day(1, [{ startTime: '18:00', endTime: '19:00' }]));

      const [a, b] = await Promise.all([put(admin, url, one), put(owner, url, two)]);
      expect([a.status, b.status]).toEqual([200, 200]);

      const read = await get(admin, url);
      const monday = read.body.data.days[0].slots;
      expect([
        JSON.stringify([{ startTime: '06:00', endTime: '07:00' }]),
        JSON.stringify([{ startTime: '18:00', endTime: '19:00' }]),
      ]).toContain(JSON.stringify(monday));
      expect(await dbDays(target.coach.id)).toHaveLength(7);
    });
  });

  describe('roles', () => {
    it('lets a coach read their own week', async () => {
      await put(admin, urlOf(bravo), week());
      const res = await get(bravo.user, urlOf(bravo));
      expect(res.status).toBe(200);
      expect(res.body.data.coachId).toBe(bravo.coach.id);
    });

    it('answers 403 when a coach reads another coach', async () => {
      const res = await get(alpha.user, urlOf(bravo));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('answers 403 when a coach saves, for their own week and for another coach', async () => {
      const own = await put(alpha.user, urlOf(alpha), week());
      const other = await put(alpha.user, urlOf(bravo), week());
      expect(own.status).toBe(403);
      expect(other.status).toBe(403);
    });

    it('answers 403 to a member for GET and PUT', async () => {
      expect((await get(member, urlOf(alpha))).status).toBe(403);
      expect((await put(member, urlOf(alpha), week())).status).toBe(403);
    });

    it('does not change the stored week when a coach tries to save', async () => {
      const before = await dbSlots(bravo.coach.id);
      await put(bravo.user, urlOf(bravo), week(day(1, [{ startTime: '01:00', endTime: '02:00' }])));
      const after = await dbSlots(bravo.coach.id);
      expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    });
  });

  describe('audit and side effects', () => {
    it('writes one COACH_AVAILABILITY_UPDATED row per save with a short before/after summary', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Audit' } });
      const url = urlOf(target);

      await put(admin, url, week(off(6), off(7))); // 5 available days, 5 slots
      await put(admin, url, week(off(1), off(2), off(3), off(4), off(5), off(6), off(7)));

      const rows = await prisma.auditLog.findMany({
        where: { userId: target.user.id, action: AuditAction.COACH_AVAILABILITY_UPDATED },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].actorId).toBe(admin.id);
      expect(rows[0].actorRole).toBe(Role.ADMIN);
      expect(rows[0].email).toBe(target.user.email);
      expect(rows[0].details).toEqual({
        coachId: target.coach.id,
        before: { configured: false, availableDays: 0, slotCount: 0 },
        after: { configured: true, availableDays: 5, slotCount: 5 },
      });
      expect(rows[1].details.before).toEqual({ configured: true, availableDays: 5, slotCount: 5 });
      expect(rows[1].details.after).toEqual({ configured: true, availableDays: 0, slotCount: 0 });
    });

    it('writes no audit row when the save is rejected', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail NoAudit' } });
      await put(admin, urlOf(target), { days: [] });
      const count = await prisma.auditLog.count({
        where: { userId: target.user.id, action: AuditAction.COACH_AVAILABILITY_UPDATED },
      });
      expect(count).toBe(0);
    });

    it('leaves class templates, slots, sessions and session coaches untouched', async () => {
      const target = await testData.createCoach({ user: { fullName: 'Avail Sessions' } });
      const cls = await createTestClass(CLASS_PREFIX);
      await linkTestClassCoach(cls.id, target.coach.id);
      const slot = await createTestSlot(cls.id);
      const session = await createTestSession(cls.id);
      await prisma.classSessionCoach.create({
        data: { sessionId: session.id, coachId: target.coach.id },
      });

      const snapshot = async () => ({
        cls: await prisma.class.findUnique({ where: { id: cls.id } }),
        slots: await prisma.classSlot.findMany({ where: { classId: cls.id } }),
        sessions: await prisma.classSession.findMany({ where: { classId: cls.id } }),
        sessionCoaches: await prisma.classSessionCoach.findMany({
          where: { session: { classId: cls.id } },
        }),
        classCoaches: await prisma.classCoach.findMany({ where: { classId: cls.id } }),
        slotCoaches: await prisma.classSlotCoach.findMany({ where: { slotId: slot.id } }),
      });

      const before = await snapshot();
      // Saves hours that would not fit the session, and then an all-unavailable week.
      const first = await put(
        admin,
        urlOf(target),
        week(day(1, [{ startTime: '01:00', endTime: '02:00' }])),
      );
      const second = await put(admin, urlOf(target), { days: [1, 2, 3, 4, 5, 6, 7].map(off) });
      expect([first.status, second.status]).toEqual([200, 200]);
      const after = await snapshot();

      expect(after).toEqual(before);
      expect(after.sessions[0].state).toBe(session.state);
      expect(after.sessionCoaches).toHaveLength(1);
    });
  });
});
