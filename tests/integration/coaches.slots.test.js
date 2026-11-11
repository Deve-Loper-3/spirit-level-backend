const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const {
  getTodayInTimezone,
  addDaysToDateStr,
  localDateTimeToUtc,
} = require('../../src/utils/timezone.util');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { setCoachWeek } = require('../helpers/coachSchedule.helper');
const {
  createTestClass,
  createTestSession,
  deleteTestClasses,
} = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PREFIX = `test_slots_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const TZ = env.FACILITY_TIMEZONE;
const TODAY = getTodayInTimezone(TZ);
const D1 = addDaysToDateStr(TODAY, 14); // day 1 of the range, well in the future
const D2 = addDaysToDateStr(D1, 1); // leave day
const D3 = addDaysToDateStr(D1, 2); // untouched day
const at = (hhmm, date = D1) => localDateTimeToUtc(date, hhmm, TZ);
const iso = (hhmm, date = D1) => at(hhmm, date).toISOString();

// 09:00-13:00 every weekday.
const WEEK = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [['09:00', '13:00']]]));

describe('open slots: GET /api/v1/coaches/:coachId/availability/slots', () => {
  const testData = createTestData('slots');
  let app;
  let admin;
  let owner;
  let member;
  let alpha; // the coach whose slots are read
  let bravo; // another coach
  let unset; // no availability saved
  let inactiveCoach;
  let type; // 60 min, no buffers
  let bufferedType; // 60 min, buffers 10 / 10

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    alpha = await testData.createCoach({ user: { fullName: 'Slots Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Slots Bravo' } });
    unset = await testData.createCoach({ user: { fullName: 'Slots Unset' } });
    inactiveCoach = await testData.createCoach({
      user: { fullName: 'Slots Inactive' },
      coach: { status: 'INACTIVE' },
    });
    await setCoachWeek(alpha.coach.id, WEEK);
    await setCoachWeek(bravo.coach.id, WEEK);
    await setCoachWeek(inactiveCoach.coach.id, WEEK);
    type = await prisma.appointmentType.create({
      data: { id: crypto.randomUUID(), name: `${PREFIX}60`, durationMin: 60 },
    });
    bufferedType = await prisma.appointmentType.create({
      data: {
        id: crypto.randomUUID(),
        name: `${PREFIX}60b`,
        durationMin: 60,
        bufferBeforeMin: 10,
        bufferAfterMin: 10,
      },
    });
  });

  const coaches = () => [alpha, bravo, unset, inactiveCoach];
  const coachIds = () => coaches().map((c) => c.coach.id);
  const userIds = () => [admin, owner, member, ...coaches().map((c) => c.user)].map((u) => u.id);

  afterEach(async () => {
    await prisma.appointment.deleteMany({ where: { coachId: { in: coachIds() } } });
    await prisma.coachUnavailability.deleteMany({ where: { coachId: { in: coachIds() } } });
    await deleteTestClasses(PREFIX);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds() } }, { userId: { in: userIds() } }] },
    });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { coachId: { in: coachIds() } } });
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.appointmentType.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const slotsUrl = (coach, params = {}) =>
    `/api/v1/coaches/${coach.coach.id}/availability/slots?${new URLSearchParams({
      appointmentTypeId: type.id,
      from: D1,
      to: D3,
      ...params,
    }).toString()}`;
  const get = (caller, url) => request(app).get(url).set(as(caller));
  const starts = (day) => day.slots.map((s) => s.startAt);
  const dayOf = (res, date) => res.body.data.days.find((d) => d.date === date);

  const insertAppointment = (coach, from, to, extra = {}) =>
    prisma.appointment.create({
      data: {
        id: crypto.randomUUID(),
        coachId: coach.coach.id,
        memberId: member.id,
        appointmentTypeId: type.id,
        startAt: at(from),
        endAt: at(to),
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        ...extra,
      },
    });

  const insertSession = async (coach, from, to) => {
    const cls = await createTestClass(PREFIX);
    const session = await createTestSession(cls.id, { startAt: at(from), endAt: at(to) });
    await prisma.classSessionCoach.create({
      data: { sessionId: session.id, coachId: coach.coach.id },
    });
    return session;
  };

  const book = (coach, startAt, apptType = type) =>
    request(app).post('/api/v1/appointments').set(as(admin)).send({
      coachId: coach.coach.id,
      memberId: member.id,
      appointmentTypeId: apptType.id,
      startAt,
    });

  it('round trip: availability + a session + an appointment + leave', async () => {
    await insertSession(alpha, '10:30', '11:30'); // splits D1
    await insertAppointment(alpha, '12:00', '13:00'); // takes the end of D1
    await prisma.coachUnavailability.create({
      data: {
        id: crypto.randomUUID(),
        coachId: alpha.coach.id,
        startDate: new Date(`${D2}T00:00:00.000Z`),
        endDate: new Date(`${D2}T00:00:00.000Z`),
        reason: 'Test leave',
      },
    });

    const res = await get(admin, slotsUrl(alpha));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      coachId: alpha.coach.id,
      appointmentTypeId: type.id,
      timezone: TZ,
      from: D1,
      to: D3,
      availabilityConfigured: true,
    });
    expect(res.body.data.days.map((d) => d.date)).toEqual([D1, D2, D3]); // every day present

    // D1: 09:00-10:30 free (one slot), session 10:30-11:30, 11:30-12:00 too short, appointment 12-13
    expect(dayOf(res, D1).slots).toEqual([{ startAt: iso('09:00'), endAt: iso('10:00') }]);
    expect(dayOf(res, D2).slots).toEqual([]); // leave
    expect(starts(dayOf(res, D3))).toEqual(
      ['09:00', '10:00', '11:00', '12:00'].map((t) => iso(t, D3)),
    );
    dayOf(res, D3).slots.forEach((s) => {
      expect(s.startAt).toMatch(ISO_UTC);
      expect(s.endAt).toMatch(ISO_UTC);
    });
  });

  it('the type buffers (own and existing) shape the slots', async () => {
    await insertAppointment(alpha, '11:00', '12:00', { bufferBeforeMin: 10, bufferAfterMin: 10 });
    const res = await get(admin, slotsUrl(alpha, { appointmentTypeId: bufferedType.id, to: D1 }));
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(1);
    // The existing appointment occupies 10:50-12:10; the new type's own buffers (10 / 10) widen that to
    // 10:40-12:20. Left over: 09:00-10:40 (one 60-minute slot) and 12:20-13:00 (too short).
    expect(dayOf(res, D1).slots).toEqual([{ startAt: iso('09:00'), endAt: iso('10:00') }]);
  });

  it('a slot that is returned can be booked, one that is not returned is refused (409)', async () => {
    await insertSession(alpha, '10:30', '11:30');
    const res = await get(admin, slotsUrl(alpha, { to: D1 }));
    const free = dayOf(res, D1).slots;
    expect(free.length).toBeGreaterThan(0);

    const booked = await book(alpha, free[0].startAt);
    expect(booked.status).toBe(201);
    expect(booked.body.data.endAt).toBe(free[0].endAt);

    // the booked slot disappears, and a start inside the session was never offered
    const after = await get(admin, slotsUrl(alpha, { to: D1 }));
    expect(starts(dayOf(after, D1))).not.toContain(free[0].startAt);
    const refused = await book(alpha, iso('10:30'));
    expect([refused.status, refused.body.code]).toEqual([409, 'COACH_CONFLICT']);
    expect(refused.body.details.conflicts[0].type).toBe('SESSION_OVERLAP');
  });

  it('every offered slot is accepted by POST /appointments (same rules)', async () => {
    await insertSession(alpha, '10:30', '11:30');
    await insertAppointment(alpha, '12:00', '12:30', { bufferBeforeMin: 5, bufferAfterMin: 5 });
    const res = await get(admin, slotsUrl(alpha, { appointmentTypeId: bufferedType.id, to: D1 }));
    for (const slot of dayOf(res, D1).slots) {
      const booked = await book(alpha, slot.startAt, bufferedType);
      expect(booked.status).toBe(201);
      await prisma.appointment.delete({ where: { id: booked.body.data.id } });
    }
  });

  it('excludeAppointmentId gives the moved appointment its own time back', async () => {
    const existing = await insertAppointment(alpha, '09:00', '10:00');
    const without = await get(admin, slotsUrl(alpha, { to: D1 }));
    expect(starts(dayOf(without, D1))).not.toContain(iso('09:00'));
    const withExclude = await get(
      admin,
      slotsUrl(alpha, { to: D1, excludeAppointmentId: existing.id }),
    );
    expect(starts(dayOf(withExclude, D1))).toContain(iso('09:00'));
  });

  it('a cancelled appointment and a cancelled session do not remove slots', async () => {
    await insertAppointment(alpha, '09:00', '10:00', {
      state: 'CANCELLED',
      cancelledAt: new Date(),
    });
    const session = await insertSession(alpha, '10:00', '11:00');
    await prisma.classSession.update({ where: { id: session.id }, data: { state: 'CANCELLED' } });
    const res = await get(admin, slotsUrl(alpha, { to: D1 }));
    expect(dayOf(res, D1).slots).toHaveLength(4);
  });

  it("other coaches' items do not matter", async () => {
    await insertAppointment(bravo, '09:00', '13:00');
    const res = await get(admin, slotsUrl(alpha, { to: D1 }));
    expect(dayOf(res, D1).slots).toHaveLength(4);
  });

  it('past times are never returned: a range starting yesterday has no slot before now', async () => {
    const yesterday = addDaysToDateStr(TODAY, -1);
    const res = await get(admin, slotsUrl(alpha, { from: yesterday, to: TODAY }));
    expect(res.status).toBe(200);
    const now = Date.now();
    res.body.data.days
      .flatMap((d) => d.slots)
      .forEach((slot) => expect(new Date(slot.startAt).getTime()).toBeGreaterThan(now));
    expect(dayOf(res, yesterday).slots).toEqual([]);
    expect(res.body.data.days).toHaveLength(2);
  });

  it('a coach with no saved hours: empty days and availabilityConfigured false', async () => {
    const res = await get(admin, slotsUrl(unset));
    expect(res.status).toBe(200);
    expect(res.body.data.availabilityConfigured).toBe(false);
    expect(res.body.data.days).toHaveLength(3);
    expect(res.body.data.days.every((d) => d.slots.length === 0)).toBe(true);
  });

  describe('roles and errors', () => {
    it('ADMIN and OWNER read any coach; a coach reads their own; another coach and a member are 403', async () => {
      expect((await get(admin, slotsUrl(bravo))).status).toBe(200);
      expect((await get(owner, slotsUrl(alpha))).status).toBe(200);
      expect((await get(alpha.user, slotsUrl(alpha))).status).toBe(200);
      expect((await get(bravo.user, slotsUrl(alpha))).status).toBe(403);
      expect((await get(member, slotsUrl(alpha))).status).toBe(403);
    });

    it('401 without a token', async () => {
      expect((await request(app).get(slotsUrl(alpha))).status).toBe(401);
    });

    it('404 for an unknown coach and an unknown type', async () => {
      const coach = await get(admin, slotsUrl(alpha).replace(alpha.coach.id, MISSING_ID));
      expect([coach.status, coach.body.code]).toEqual([404, 'COACH_NOT_FOUND']);
      const unknownType = await get(admin, slotsUrl(alpha, { appointmentTypeId: MISSING_ID }));
      expect([unknownType.status, unknownType.body.code]).toEqual([
        404,
        'APPOINTMENT_TYPE_NOT_FOUND',
      ]);
    });

    it('409 for an inactive type and an inactive coach', async () => {
      const off = await prisma.appointmentType.create({
        data: { id: crypto.randomUUID(), name: `${PREFIX}off`, durationMin: 30, isActive: false },
      });
      const inactiveType = await get(admin, slotsUrl(alpha, { appointmentTypeId: off.id }));
      expect([inactiveType.status, inactiveType.body.code]).toEqual([
        409,
        'APPOINTMENT_TYPE_INACTIVE',
      ]);
      const coach = await get(admin, slotsUrl(inactiveCoach));
      expect([coach.status, coach.body.code]).toEqual([409, 'COACH_INACTIVE']);
    });

    it('400 for missing, malformed and too long parameters', async () => {
      const base = `/api/v1/coaches/${alpha.coach.id}/availability/slots`;
      expect((await get(admin, base)).status).toBe(400);
      expect((await get(admin, slotsUrl(alpha, { from: 'tomorrow' }))).status).toBe(400);
      expect((await get(admin, slotsUrl(alpha, { from: D3, to: D1 }))).status).toBe(400);
      expect(
        (await get(admin, slotsUrl(alpha, { from: D1, to: addDaysToDateStr(D1, 31) }))).status,
      ).toBe(400); // 32 days
      expect(
        (await get(admin, slotsUrl(alpha, { from: D1, to: addDaysToDateStr(D1, 30) }))).status,
      ).toBe(200); // 31 days
      expect((await get(admin, slotsUrl(alpha, { step: '30' }))).status).toBe(400);
      const badCoach = await get(admin, slotsUrl(alpha).replace(alpha.coach.id, 'not-a-uuid'));
      expect(badCoach.status).toBe(400);
    });

    it('405 for other methods, with Allow: GET; the weekly availability route is unaffected', async () => {
      const post = await request(app)
        .post(`/api/v1/coaches/${alpha.coach.id}/availability/slots`)
        .set(as(admin))
        .send({});
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET');
      const week = await get(admin, `/api/v1/coaches/${alpha.coach.id}/availability`);
      expect(week.status).toBe(200);
      expect(week.body.data.days).toHaveLength(7);
    });
  });
});
