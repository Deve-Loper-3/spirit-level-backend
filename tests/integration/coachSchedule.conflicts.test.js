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
const { setCoachWeek, openAllWeek } = require('../helpers/coachSchedule.helper');
const {
  createTestClass,
  createTestSession,
  deleteTestClasses,
} = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const APPOINTMENTS_URL = '/api/v1/appointments';
const ELIGIBLE_URL = '/api/v1/coaches/eligible';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PREFIX = `test_sched_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const TZ = env.FACILITY_TIMEZONE;
const D = addDaysToDateStr(getTodayInTimezone(TZ), 14); // a facility day well in the future
const NEXT_D = addDaysToDateStr(D, 1);
const at = (hhmm, date = D) => localDateTimeToUtc(date, hhmm, TZ);
const iso = (hhmm, date = D) => at(hhmm, date).toISOString();

// Hours 09:00-12:00 and 12:00-15:00 on every weekday (two touching slots).
const workWeek = () =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((d) => [
      d,
      [
        ['09:00', '12:00'],
        ['12:00', '15:00'],
      ],
    ]),
  );

describe('coach schedule conflicts: appointments and GET /coaches/eligible', () => {
  const testData = createTestData('sched');
  let app;
  let admin;
  let owner;
  let member;
  let worker; // 09:00-15:00 (two touching slots), the coach most tests book
  let allDay; // 00:00-23:59
  let noHours; // no availability saved
  let dayOff; // every weekday saved as a day off
  let onLeave; // works, but is on leave on D
  let inactive; // INACTIVE coach (not listed by /eligible)
  let type; // 60 min, buffers 5 / 10
  let plainType; // 60 min, no buffers
  let coachCoachUser;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    worker = await testData.createCoach({ user: { fullName: 'Sched Worker' } });
    allDay = await testData.createCoach({ user: { fullName: 'Sched AllDay' } });
    noHours = await testData.createCoach({ user: { fullName: 'Sched NoHours' } });
    dayOff = await testData.createCoach({ user: { fullName: 'Sched DayOff' } });
    onLeave = await testData.createCoach({ user: { fullName: 'Sched OnLeave' } });
    inactive = await testData.createCoach({
      user: { fullName: 'Sched Inactive' },
      coach: { status: 'INACTIVE' },
    });
    coachCoachUser = worker.user;
    await setCoachWeek(worker.coach.id, workWeek());
    await openAllWeek(allDay.coach.id);
    await setCoachWeek(
      dayOff.coach.id,
      Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, null])),
    );
    await setCoachWeek(onLeave.coach.id, workWeek());
    await openAllWeek(inactive.coach.id);
    type = await prisma.appointmentType.create({
      data: {
        id: crypto.randomUUID(),
        name: `${PREFIX}PT`,
        durationMin: 60,
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      },
    });
    plainType = await prisma.appointmentType.create({
      data: { id: crypto.randomUUID(), name: `${PREFIX}Plain`, durationMin: 60 },
    });
  });

  const coaches = () => [worker, allDay, noHours, dayOff, onLeave, inactive];
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
  const get = (caller, url) => request(app).get(url).set(as(caller));
  const book = (coach, startIso, apptType = type) =>
    request(app).post(APPOINTMENTS_URL).set(as(admin)).send({
      coachId: coach.coach.id,
      memberId: member.id,
      appointmentTypeId: apptType.id,
      startAt: startIso,
    });

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

  const insertSession = async (coach, from, to, overrides = {}) => {
    const cls = await createTestClass(PREFIX);
    const session = await createTestSession(cls.id, {
      startAt: at(from),
      endAt: at(to),
      ...overrides,
    });
    await prisma.classSessionCoach.create({
      data: { sessionId: session.id, coachId: coach.coach.id },
    });
    return session;
  };

  const conflictOf = (res) => res.body.details.conflicts[0];
  const apptCount = (coach) => prisma.appointment.count({ where: { coachId: coach.coach.id } });

  describe('POST /appointments enforces the engine (every conflict type is a 409 COACH_CONFLICT)', () => {
    it('books a free interval inside the hours; touching slots count as one', async () => {
      expect((await book(worker, iso('10:00'))).status).toBe(201);
      // 11:30-12:30 crosses the join of 09:00-12:00 and 12:00-15:00
      const across = await book(worker, iso('11:30'), plainType);
      expect(across.status).toBe(201);
    });

    it('AVAILABILITY_NOT_SET: no hours saved, with the full details shape', async () => {
      const res = await book(noHours, iso('10:00'));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COACH_CONFLICT');
      expect(conflictOf(res)).toEqual({
        type: 'AVAILABILITY_NOT_SET',
        coachId: noHours.coach.id,
        message: expect.any(String),
        conflictingItem: null,
      });
      expect(await apptCount(noHours)).toBe(0);
    });

    it('OUTSIDE_AVAILABILITY: after the hours, partly outside, a day off, across midnight', async () => {
      expect(conflictOf(await book(worker, iso('16:00'))).type).toBe('OUTSIDE_AVAILABILITY');
      expect(conflictOf(await book(worker, iso('14:30'))).type).toBe('OUTSIDE_AVAILABILITY');
      expect(conflictOf(await book(dayOff, iso('10:00'))).type).toBe('OUTSIDE_AVAILABILITY');
      expect(conflictOf(await book(allDay, iso('23:30'))).type).toBe('OUTSIDE_AVAILABILITY');
      expect(await apptCount(worker)).toBe(0);
    });

    it('COACH_UNAVAILABLE: leave blocks the whole day, with the leave as the item', async () => {
      const leave = await prisma.coachUnavailability.create({
        data: {
          id: crypto.randomUUID(),
          coachId: onLeave.coach.id,
          startDate: new Date(`${D}T00:00:00.000Z`),
          endDate: new Date(`${D}T00:00:00.000Z`),
          reason: 'Test leave',
        },
      });
      const res = await book(onLeave, iso('10:00'));
      expect(res.status).toBe(409);
      expect(conflictOf(res)).toMatchObject({
        type: 'COACH_UNAVAILABLE',
        coachId: onLeave.coach.id,
        conflictingItem: { kind: 'LEAVE', id: leave.id },
      });
      expect(conflictOf(res).conflictingItem.startAt).toMatch(ISO_UTC);
      // the next day is free
      expect((await book(onLeave, iso('10:00', NEXT_D))).status).toBe(201);
    });

    it('SESSION_OVERLAP: overlapping blocks, touching is fine, a cancelled session never blocks', async () => {
      const session = await insertSession(worker, '10:00', '11:00');
      const res = await book(worker, iso('10:30'), plainType);
      expect(res.status).toBe(409);
      expect(conflictOf(res)).toMatchObject({
        type: 'SESSION_OVERLAP',
        conflictingItem: { kind: 'SESSION', id: session.id },
      });
      // plain type, touching the session end: raw time only, so it fits
      expect((await book(worker, iso('11:00'), plainType)).status).toBe(201);

      await prisma.classSession.update({ where: { id: session.id }, data: { state: 'CANCELLED' } });
      expect((await book(worker, iso('09:00'), plainType)).status).toBe(201);
      expect((await book(allDay, iso('10:30'), plainType)).status).toBe(201);
    });

    it('a session does not take the new appointment buffers into account', async () => {
      await insertSession(worker, '11:00', '12:00');
      // type buffers 5 / 10: 10:00-11:00 occupies 09:55-11:10 for appointments, but sessions block raw time
      expect((await book(worker, iso('10:00'))).status).toBe(201);
    });

    it('APPOINTMENT_OVERLAP: another BOOKED appointment at the same time', async () => {
      const existing = await insertAppointment(worker, '10:00', '11:00');
      const res = await book(worker, iso('10:30'), plainType);
      expect(res.status).toBe(409);
      expect(conflictOf(res)).toMatchObject({
        type: 'APPOINTMENT_OVERLAP',
        conflictingItem: { kind: 'APPOINTMENT', id: existing.id },
      });
    });

    it('APPOINTMENT_BUFFER: own and existing buffers extend the footprint', async () => {
      const existing = await insertAppointment(worker, '10:00', '11:00', { bufferAfterMin: 15 });
      // plain type, starts 10 minutes after the end: inside the existing 15-minute buffer
      const res = await book(worker, iso('11:10'), plainType);
      expect(conflictOf(res)).toMatchObject({
        type: 'APPOINTMENT_BUFFER',
        conflictingItem: { id: existing.id },
      });
      expect((await book(worker, iso('11:15'), plainType)).status).toBe(201);
    });

    it("APPOINTMENT_BUFFER: the new appointment's own buffers extend its footprint", async () => {
      const existing = await insertAppointment(worker, '11:00', '12:00');
      // type buffers 5 / 10: 10:00-11:00 touches the appointment, but its after-buffer runs to 11:10
      const res = await book(worker, iso('10:00'));
      expect(conflictOf(res)).toMatchObject({
        type: 'APPOINTMENT_BUFFER',
        conflictingItem: { id: existing.id },
      });
      expect((await book(worker, iso('09:00'))).status).toBe(201); // 09:00-10:00 (+10) ends 10:10
    });

    it('a cancelled appointment never blocks', async () => {
      await insertAppointment(worker, '10:00', '11:00', {
        state: 'CANCELLED',
        cancelledAt: new Date(),
      });
      expect((await book(worker, iso('10:00'), plainType)).status).toBe(201);
    });

    it('first failing rule wins: no hours beats an overlapping session', async () => {
      await insertSession(noHours, '10:00', '11:00');
      expect(conflictOf(await book(noHours, iso('10:00'))).type).toBe('AVAILABILITY_NOT_SET');
    });

    it('COACH_INACTIVE and unknown coach keep their own errors', async () => {
      expect((await book(inactive, iso('10:00'))).body.code).toBe('COACH_INACTIVE');
      const unknown = await request(app)
        .post(APPOINTMENTS_URL)
        .set(as(admin))
        .send({
          coachId: MISSING_ID,
          memberId: member.id,
          appointmentTypeId: type.id,
          startAt: iso('10:00'),
        });
      expect(unknown.body.code).toBe('COACH_NOT_FOUND');
    });

    it('two simultaneous bookings of the same slot: exactly one wins', async () => {
      const [a, b] = await Promise.all([book(worker, iso('10:00')), book(worker, iso('10:00'))]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await apptCount(worker)).toBe(1);
    });
  });

  describe('GET /coaches/eligible', () => {
    const query = (params) => `${ELIGIBLE_URL}?${new URLSearchParams(params).toString()}`;
    const mine = (res) => res.body.data.filter((row) => coachIds().includes(row.coachId));
    const byId = (res, coach) => mine(res).find((row) => row.coachId === coach.coach.id);

    it('lists ACTIVE coaches with eligible / conflict, for a start + end', async () => {
      await insertSession(allDay, '10:00', '11:00');
      await insertAppointment(worker, '10:00', '11:00');
      const res = await get(admin, query({ startAt: iso('10:00'), endAt: iso('11:00') }));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      expect(mine(res)).toHaveLength(5); // the inactive coach is not listed
      expect(byId(res, inactive)).toBeUndefined();
      expect(byId(res, worker)).toMatchObject({
        fullName: 'Sched Worker',
        eligible: false,
        conflict: { type: 'APPOINTMENT_OVERLAP', conflictingItem: { kind: 'APPOINTMENT' } },
      });
      expect(byId(res, allDay).conflict.type).toBe('SESSION_OVERLAP');
      expect(byId(res, noHours).conflict).toMatchObject({
        type: 'AVAILABILITY_NOT_SET',
        conflictingItem: null,
      });
      expect(byId(res, dayOff).conflict.type).toBe('OUTSIDE_AVAILABILITY');
      expect(Object.keys(byId(res, worker))).toEqual([
        'coachId',
        'fullName',
        'eligible',
        'conflict',
      ]);
    });

    it('a coach that is free is eligible with an explicit null conflict', async () => {
      const res = await get(admin, query({ startAt: iso('13:00'), endAt: iso('14:00') }));
      expect(byId(res, worker)).toEqual({
        coachId: worker.coach.id,
        fullName: 'Sched Worker',
        eligible: true,
        conflict: null,
      });
      expect(byId(res, allDay).eligible).toBe(true);
    });

    it('with appointmentTypeId the end and the buffers come from the type', async () => {
      await insertAppointment(worker, '10:00', '11:00');
      // plain: 11:00-12:00 touches the appointment -> eligible
      const plain = await get(
        owner,
        query({ startAt: iso('11:00'), appointmentTypeId: plainType.id }),
      );
      expect(byId(plain, worker).eligible).toBe(true);
      // buffered (before 5): 11:00 start needs 10:55 -> clashes with the appointment end
      const buffered = await get(
        owner,
        query({ startAt: iso('11:00'), appointmentTypeId: type.id }),
      );
      expect(byId(buffered, worker).conflict.type).toBe('APPOINTMENT_BUFFER');
    });

    it('excludeSessionId and excludeAppointmentId let an item be moved onto its own time', async () => {
      const session = await insertSession(allDay, '10:00', '11:00');
      const appointment = await insertAppointment(worker, '10:00', '11:00');
      const params = { startAt: iso('10:00'), endAt: iso('11:00') };
      expect(byId(await get(admin, query(params)), allDay).eligible).toBe(false);
      expect(
        byId(await get(admin, query({ ...params, excludeSessionId: session.id })), allDay).eligible,
      ).toBe(true);
      expect(
        byId(await get(admin, query({ ...params, excludeAppointmentId: appointment.id })), worker)
          .eligible,
      ).toBe(true);
    });

    it('is not swallowed by /coaches/:coachId, and the existing coach routes still work', async () => {
      const eligible = await get(admin, query({ startAt: iso('10:00'), endAt: iso('11:00') }));
      expect(eligible.status).toBe(200); // not 400 "coach id must be a valid UUID"
      expect(Array.isArray(eligible.body.data)).toBe(true);

      const list = await get(admin, '/api/v1/coaches?limit=5');
      expect(list.status).toBe(200);
      expect(list.body.pagination).toBeDefined();
      const one = await get(admin, `/api/v1/coaches/${worker.coach.id}`);
      expect(one.status).toBe(200);
      expect(one.body.data.id).toBe(worker.coach.id);
    });

    it('404 for an unknown type, 409 for an inactive type', async () => {
      const unknown = await get(
        admin,
        query({ startAt: iso('10:00'), appointmentTypeId: MISSING_ID }),
      );
      expect([unknown.status, unknown.body.code]).toEqual([404, 'APPOINTMENT_TYPE_NOT_FOUND']);
      const off = await prisma.appointmentType.create({
        data: { id: crypto.randomUUID(), name: `${PREFIX}Off`, durationMin: 30, isActive: false },
      });
      const res = await get(admin, query({ startAt: iso('10:00'), appointmentTypeId: off.id }));
      expect([res.status, res.body.code]).toEqual([409, 'APPOINTMENT_TYPE_INACTIVE']);
    });

    it('400 for missing / conflicting / bad parameters', async () => {
      const start = iso('10:00');
      const end = iso('11:00');
      expect((await get(admin, query({ endAt: end }))).status).toBe(400); // no startAt
      expect((await get(admin, query({ startAt: start }))).status).toBe(400); // no end or type
      expect(
        (await get(admin, query({ startAt: start, endAt: end, appointmentTypeId: type.id })))
          .status,
      ).toBe(400); // both
      expect((await get(admin, query({ startAt: end, endAt: start }))).status).toBe(400); // inverted
      expect((await get(admin, query({ startAt: '2030-01-01T10:00:00', endAt: end }))).status).toBe(
        400,
      );
      expect(
        (await get(admin, query({ startAt: start, endAt: end, excludeSessionId: 'x' }))).status,
      ).toBe(400);
      const unknownParam = await get(admin, query({ startAt: start, endAt: end, page: '1' }));
      expect(unknownParam.status).toBe(400);
      expect(unknownParam.body.code).toBe('VALIDATION_ERROR');
    });

    it('403 for a coach and a member, 401 without a token, 405 for other methods', async () => {
      const q = query({ startAt: iso('10:00'), endAt: iso('11:00') });
      expect((await get(coachCoachUser, q)).status).toBe(403);
      expect((await get(member, q)).status).toBe(403);
      expect((await request(app).get(q)).status).toBe(401);
      const post = await request(app).post(ELIGIBLE_URL).set(as(admin)).send({});
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET');
    });
  });

  it('class sessions are not changed by any of this', async () => {
    const session = await insertSession(worker, '10:00', '11:00');
    const before = await prisma.classSession.findUnique({ where: { id: session.id } });
    await book(worker, iso('10:30'), plainType); // 409
    await book(worker, iso('13:00'), plainType); // 201
    await get(
      admin,
      `${ELIGIBLE_URL}?startAt=${encodeURIComponent(iso('10:00'))}&endAt=${encodeURIComponent(iso('11:00'))}`,
    );
    expect(await prisma.classSession.findUnique({ where: { id: session.id } })).toEqual(before);
    expect(await prisma.classSessionCoach.count({ where: { sessionId: session.id } })).toBe(1);
  });
});
