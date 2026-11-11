const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const {
  getTodayInTimezone,
  addDaysToDateStr,
  localDateTimeToUtc,
} = require('../../src/utils/timezone.util');
const { generateSessionsForWindow } = require('../../src/services/schedule.service');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { setCoachWeek, openAllWeek } = require('../helpers/coachSchedule.helper');
const { createTestClass, deleteTestClasses } = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const SESSIONS_URL = '/api/v1/sessions';
const COVERAGE_URL = `${SESSIONS_URL}/coverage`;
const PREFIX = `test_sesched_${Date.now()}_`;

const TZ = env.FACILITY_TIMEZONE;
const TODAY = getTodayInTimezone(TZ);
const day = (n) => addDaysToDateStr(TODAY, 14 + n); // days well in the future
const at = (hhmm, date) => localDateTimeToUtc(date, hhmm, TZ);
const iso = (hhmm, date) => at(hhmm, date).toISOString();
const dateOnly = (d) => new Date(`${d}T00:00:00.000Z`);

describe('coach schedule on the manual session paths + GET /sessions/coverage', () => {
  const testData = createTestData('sesched');
  let app;
  let admin;
  let owner;
  let member;
  let alpha; // class coach, works all day
  let bravo; // class coach, works all day
  let narrow; // class coach, works 09:00-12:00 only
  let unset; // class coach, no hours saved
  let outsider; // NOT on the class template, works all day
  let outsiderNoHours; // NOT on the class template, no hours saved
  let cls;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    alpha = await testData.createCoach({ user: { fullName: 'Sess Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Sess Bravo' } });
    narrow = await testData.createCoach({ user: { fullName: 'Sess Narrow' } });
    unset = await testData.createCoach({ user: { fullName: 'Sess Unset' } });
    outsider = await testData.createCoach({ user: { fullName: 'Sess Outsider' } });
    outsiderNoHours = await testData.createCoach({ user: { fullName: 'Sess OutsiderNoHours' } });
    await openAllWeek(outsider.coach.id);
    await openAllWeek(alpha.coach.id);
    await openAllWeek(bravo.coach.id);
    await setCoachWeek(
      narrow.coach.id,
      Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [['09:00', '12:00']]])),
    );

    cls = await createTestClass(PREFIX, { durationMin: 60, baseCapacity: 12 });
    await prisma.classCoach.createMany({
      data: [alpha, bravo, narrow, unset].map((c) => ({ classId: cls.id, coachId: c.coach.id })),
    });
  });

  const coaches = () => [alpha, bravo, narrow, unset, outsider, outsiderNoHours];
  const coachIds = () => coaches().map((c) => c.coach.id);
  const userIds = () => [admin, owner, member, ...coaches().map((c) => c.user)].map((u) => u.id);

  afterEach(async () => {
    await prisma.appointment.deleteMany({ where: { coachId: { in: coachIds() } } });
    await prisma.coachUnavailability.deleteMany({ where: { coachId: { in: coachIds() } } });
    await prisma.classSession.deleteMany({ where: { classId: cls.id } });
    await openAllWeek(alpha.coach.id); // one test saves a week of days off for alpha
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
  const post = (caller, url, body) => request(app).post(url).set(as(caller)).send(body);
  const patch = (caller, url, body) => request(app).patch(url).set(as(caller)).send(body);

  const createSession = (from, date, coachList, extra = {}) =>
    post(admin, SESSIONS_URL, {
      classId: cls.id,
      startAt: iso(from, date),
      endAt: iso(addHour(from), date),
      coachIds: coachList.map((c) => c.coach.id),
      ...extra,
    });
  const addHour = (hhmm) =>
    `${String(Number(hhmm.slice(0, 2)) + 1).padStart(2, '0')}:${hhmm.slice(3)}`;

  const insertSession = (from, date, coachList, extra = {}) =>
    prisma.classSession.create({
      data: {
        id: crypto.randomUUID(),
        classId: cls.id,
        startAt: at(from, date),
        endAt: at(addHour(from), date),
        durationMin: 60,
        capacity: 12,
        state: 'OPEN',
        version: 1,
        coaches: { create: coachList.map((c) => ({ coachId: c.coach.id })) },
        ...extra,
      },
    });

  const insertLeave = (coach, startDate, endDate = startDate) =>
    prisma.coachUnavailability.create({
      data: {
        id: crypto.randomUUID(),
        coachId: coach.coach.id,
        startDate: dateOnly(startDate),
        endDate: dateOnly(endDate),
        reason: 'Test leave',
      },
    });

  const conflictOf = (res) => res.body.details.conflicts[0];
  const sessionCoachIds = async (id) =>
    (await prisma.classSessionCoach.findMany({ where: { sessionId: id } }))
      .map((r) => r.coachId)
      .sort();

  describe('POST /sessions (create)', () => {
    it('accepts a coach that is available', async () => {
      const res = await createSession('10:00', day(0), [alpha]);
      expect(res.status).toBe(201);
      expect(res.body.data.coaches.map((c) => c.id)).toEqual([alpha.coach.id]);
    });

    it('AVAILABILITY_NOT_SET: a class coach with no hours saved', async () => {
      const res = await createSession('10:00', day(0), [unset]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COACH_CONFLICT');
      expect(conflictOf(res)).toMatchObject({
        type: 'AVAILABILITY_NOT_SET',
        coachId: unset.coach.id,
        conflictingItem: null,
      });
      expect(await prisma.classSession.count({ where: { classId: cls.id } })).toBe(0);
    });

    it('OUTSIDE_AVAILABILITY: after the coach hours', async () => {
      const res = await createSession('14:00', day(0), [narrow]);
      expect(res.status).toBe(409);
      expect(conflictOf(res).type).toBe('OUTSIDE_AVAILABILITY');
    });

    it('COACH_UNAVAILABLE: the coach is on leave that day, the next day is fine', async () => {
      await insertLeave(alpha, day(1));
      const res = await createSession('10:00', day(1), [alpha]);
      expect(res.status).toBe(409);
      expect(conflictOf(res)).toMatchObject({
        type: 'COACH_UNAVAILABLE',
        conflictingItem: { kind: 'LEAVE' },
      });
      expect((await createSession('10:00', day(2), [alpha])).status).toBe(201);
    });

    it('APPOINTMENT_OVERLAP and APPOINTMENT_BUFFER from a BOOKED appointment', async () => {
      const type = await prisma.appointmentType.create({
        data: { id: crypto.randomUUID(), name: `${PREFIX}PT`, durationMin: 60 },
      });
      await prisma.appointment.create({
        data: {
          id: crypto.randomUUID(),
          coachId: alpha.coach.id,
          memberId: member.id,
          appointmentTypeId: type.id,
          startAt: at('10:00', day(3)),
          endAt: at('11:00', day(3)),
          bufferBeforeMin: 0,
          bufferAfterMin: 30,
        },
      });
      const overlap = await createSession('10:00', day(3), [alpha]);
      expect([overlap.status, conflictOf(overlap).type]).toEqual([409, 'APPOINTMENT_OVERLAP']);
      const buffer = await createSession('11:00', day(3), [alpha]); // inside the 30-minute buffer
      expect([buffer.status, conflictOf(buffer).type]).toEqual([409, 'APPOINTMENT_BUFFER']);
      expect((await createSession('11:30', day(3), [alpha])).status).toBe(201);
    });

    it('a session-vs-session overlap keeps the existing COACH_CONFLICT entry shape', async () => {
      await insertSession('10:00', day(4), [alpha]);
      const res = await createSession('10:30', day(4), [alpha]);
      expect(res.status).toBe(409);
      expect(conflictOf(res)).toMatchObject({ type: 'COACH_CONFLICT', coachId: alpha.coach.id });
      expect(conflictOf(res).sessionId).toBeDefined();
    });

    it('a cancelled session of the coach never blocks', async () => {
      await insertSession('10:00', day(4), [alpha], { state: 'CANCELLED' });
      // a different start time: the same class cannot have two sessions at one start, cancelled or not
      expect((await createSession('10:30', day(4), [alpha], {})).status).toBe(201);
    });
  });

  describe('PATCH /sessions/:id (replacement flow)', () => {
    it('replaces the coach of ONE session: template and other instances are untouched, audit written', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const other = await insertSession('10:00', day(1), [alpha]);
      const templateBefore = await prisma.classCoach.findMany({ where: { classId: cls.id } });

      const res = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [bravo.coach.id],
        overrideReasons: { coachIds: 'Alpha is unwell' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.coaches.map((c) => c.id)).toEqual([bravo.coach.id]);
      expect(res.body.data.overriddenFields).toContain('coachIds');

      expect(await sessionCoachIds(target.id)).toEqual([bravo.coach.id]);
      expect(await sessionCoachIds(other.id)).toEqual([alpha.coach.id]); // other occurrence
      const templateAfter = await prisma.classCoach.findMany({ where: { classId: cls.id } });
      expect(templateAfter.map((r) => r.coachId).sort()).toEqual(
        templateBefore.map((r) => r.coachId).sort(), // the class template
      );

      const audit = await prisma.auditLog.findMany({
        where: { action: AuditAction.SESSION_COACH_REPLACED, actorId: admin.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toEqual({
        sessionId: target.id,
        classId: cls.id,
        previousCoachIds: [alpha.coach.id],
        newCoachIds: [bravo.coach.id],
      });
    });

    it('rejects a replacement coach that is not available: nothing changes, nothing audited', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const url = `${SESSIONS_URL}/${target.id}`;
      const reasons = { overrideReasons: { coachIds: 'Replacement' } };

      const noHours = await patch(admin, url, { coachIds: [unset.coach.id], ...reasons });
      expect([noHours.status, conflictOf(noHours).type]).toEqual([409, 'AVAILABILITY_NOT_SET']);

      await insertLeave(bravo, day(0));
      const onLeave = await patch(admin, url, { coachIds: [bravo.coach.id], ...reasons });
      expect([onLeave.status, conflictOf(onLeave).type]).toEqual([409, 'COACH_UNAVAILABLE']);

      const outside = await patch(admin, url, {
        coachIds: [narrow.coach.id],
        overrideReasons: { coachIds: 'x', startAt: 'x', endAt: 'x' },
        startAt: iso('14:00', day(0)),
        endAt: iso('15:00', day(0)),
      });
      expect([outside.status, conflictOf(outside).type]).toEqual([409, 'OUTSIDE_AVAILABILITY']);

      expect(await sessionCoachIds(target.id)).toEqual([alpha.coach.id]);
      expect(
        await prisma.auditLog.count({ where: { action: AuditAction.SESSION_COACH_REPLACED } }),
      ).toBe(0);
    });

    it('validates the FINAL set: keeping a coach who is on leave blocks the replacement of the other', async () => {
      const target = await insertSession('10:00', day(0), [alpha, bravo]);
      await insertLeave(alpha, day(0));
      const res = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [alpha.coach.id, narrow.coach.id],
        overrideReasons: { coachIds: 'Swap bravo for narrow' },
      });
      expect([res.status, conflictOf(res).type, conflictOf(res).coachId]).toEqual([
        409,
        'COACH_UNAVAILABLE',
        alpha.coach.id,
      ]);
      // dropping the unavailable coach is what makes it valid
      const ok = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [bravo.coach.id],
        overrideReasons: { coachIds: 'Alpha is out' },
      });
      expect(ok.status).toBe(200);
    });

    it('unrelated edits are not checked: capacity, and the same coaches resent, pass even while the coach is on leave', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      await insertLeave(alpha, day(0)); // leave added after the session was planned
      const url = `${SESSIONS_URL}/${target.id}`;
      const cap = await patch(admin, url, {
        capacity: 14,
        overrideReasons: { capacity: 'More room' },
      });
      expect(cap.status).toBe(200);
      const same = await patch(admin, url, {
        coachIds: [alpha.coach.id],
        overrideReasons: { coachIds: 'unchanged' },
      });
      expect(same.status).toBe(200);
      expect(
        await prisma.auditLog.count({ where: { action: AuditAction.SESSION_COACH_REPLACED } }),
      ).toBe(0);
    });

    it('a time change re-checks the existing coaches for the new time', async () => {
      const target = await insertSession('10:00', day(0), [narrow]);
      const url = `${SESSIONS_URL}/${target.id}`;
      const tooLate = await patch(admin, url, {
        startAt: iso('14:00', day(0)),
        endAt: iso('15:00', day(0)),
        overrideReasons: { startAt: 'Later', endAt: 'Later' },
      });
      expect([tooLate.status, conflictOf(tooLate).type]).toEqual([409, 'OUTSIDE_AVAILABILITY']);
      const fine = await patch(admin, url, {
        startAt: iso('11:00', day(0)),
        endAt: iso('12:00', day(0)),
        overrideReasons: { startAt: 'Later', endAt: 'Later' },
      });
      expect(fine.status).toBe(200);
    });
  });

  describe('PATCH /sessions/:id: replacement by ANY active coach (not only the template coaches)', () => {
    const reasons = { overrideReasons: { coachIds: 'Cover for the day' } };

    it('a coach that is not on the class template is accepted: only that session changes, audit written', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const other = await insertSession('10:00', day(1), [alpha]);
      const templateBefore = (await prisma.classCoach.findMany({ where: { classId: cls.id } }))
        .map((r) => r.coachId)
        .sort();
      const otherBefore = await prisma.classSession.findUnique({ where: { id: other.id } });
      expect(templateBefore).not.toContain(outsider.coach.id);

      const res = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [outsider.coach.id],
        ...reasons,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.coaches.map((c) => c.id)).toEqual([outsider.coach.id]);

      expect(await sessionCoachIds(target.id)).toEqual([outsider.coach.id]);
      expect(await sessionCoachIds(other.id)).toEqual([alpha.coach.id]);
      expect(await prisma.classSession.findUnique({ where: { id: other.id } })).toEqual(
        otherBefore,
      );
      const templateAfter = (await prisma.classCoach.findMany({ where: { classId: cls.id } }))
        .map((r) => r.coachId)
        .sort();
      expect(templateAfter).toEqual(templateBefore); // the coach was NOT added to the template
      expect(await prisma.classSlotCoach.count({ where: { coachId: outsider.coach.id } })).toBe(0);

      const audit = await prisma.auditLog.findMany({
        where: { action: AuditAction.SESSION_COACH_REPLACED, actorId: admin.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({
        sessionId: target.id,
        previousCoachIds: [alpha.coach.id],
        newCoachIds: [outsider.coach.id],
      });
    });

    it('a coach the picker marks eligible is accepted; one it marks ineligible gets 409 COACH_CONFLICT', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const picker = await get(
        admin,
        `/api/v1/coaches/eligible?${new URLSearchParams({
          startAt: iso('10:00', day(0)),
          endAt: iso('11:00', day(0)),
          excludeSessionId: target.id,
        }).toString()}`,
      );
      expect(picker.status).toBe(200);
      const row = (coach) => picker.body.data.find((r) => r.coachId === coach.coach.id);
      expect(row(outsider).eligible).toBe(true);
      expect(row(outsiderNoHours)).toMatchObject({
        eligible: false,
        conflict: { type: 'AVAILABILITY_NOT_SET' },
      });

      const rejected = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [outsiderNoHours.coach.id],
        ...reasons,
      });
      expect([rejected.status, rejected.body.code]).toEqual([409, 'COACH_CONFLICT']);
      expect(conflictOf(rejected).type).toBe(row(outsiderNoHours).conflict.type); // same reason as the picker
      expect(await sessionCoachIds(target.id)).toEqual([alpha.coach.id]);

      const accepted = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [outsider.coach.id],
        ...reasons,
      });
      expect(accepted.status).toBe(200);
    });

    it('the S7 gate still applies to an off-template coach: leave and overlap are 409', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      await insertLeave(outsider, day(0));
      const onLeave = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [outsider.coach.id],
        ...reasons,
      });
      expect([onLeave.status, conflictOf(onLeave).type]).toEqual([409, 'COACH_UNAVAILABLE']);

      await prisma.coachUnavailability.deleteMany({ where: { coachId: outsider.coach.id } });
      await insertSession('10:30', day(2), [outsider]); // the outsider already teaches then
      const t2 = await insertSession('10:00', day(2), [alpha]);
      const overlap = await patch(admin, `${SESSIONS_URL}/${t2.id}`, {
        coachIds: [outsider.coach.id],
        ...reasons,
      });
      expect([overlap.status, overlap.body.code]).toEqual([409, 'COACH_CONFLICT']);
    });

    it('an unknown coach is still 400, and POST /sessions still requires a template coach', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const unknown = await patch(admin, `${SESSIONS_URL}/${target.id}`, {
        coachIds: [crypto.randomUUID()],
        ...reasons,
      });
      expect(unknown.status).toBe(400);
      const create = await createSession('10:00', day(3), [outsider]);
      expect(create.status).toBe(400); // create is unchanged: coaches must be on the template
    });
  });

  describe('POST /sessions/:id/restore', () => {
    it('is rejected while a coach is unavailable and accepted once they are free', async () => {
      const cancelled = await insertSession('10:00', day(0), [alpha], { state: 'CANCELLED' });
      const leave = await insertLeave(alpha, day(0));
      const url = `${SESSIONS_URL}/${cancelled.id}/restore`;

      const blocked = await post(admin, url, {});
      expect([blocked.status, conflictOf(blocked).type]).toEqual([409, 'COACH_UNAVAILABLE']);
      expect((await prisma.classSession.findUnique({ where: { id: cancelled.id } })).state).toBe(
        'CANCELLED',
      );

      await prisma.coachUnavailability.delete({ where: { id: leave.id } });
      const ok = await post(admin, url, {});
      expect(ok.status).toBe(200);
      expect(ok.body.data.state).toBe('open');
    });

    it('a session whose coach was replaced by an off-template coach: cancel, restore = 200; an engine conflict is still 409', async () => {
      const target = await insertSession('10:00', day(0), [alpha]);
      const url = `${SESSIONS_URL}/${target.id}`;
      const replaced = await patch(admin, url, {
        coachIds: [outsider.coach.id],
        overrideReasons: { coachIds: 'Cover' },
      });
      expect(replaced.status).toBe(200);
      const cancelled = await post(admin, `${url}/cancel`, { reason: 'Room closed' });
      expect(cancelled.status).toBe(200);

      const leave = await insertLeave(outsider, day(0));
      const blocked = await post(admin, `${url}/restore`, {});
      expect([blocked.status, blocked.body.code]).toEqual([409, 'COACH_CONFLICT']);
      expect(conflictOf(blocked).type).toBe('COACH_UNAVAILABLE');

      await prisma.coachUnavailability.delete({ where: { id: leave.id } });
      const restored = await post(admin, `${url}/restore`, {});
      expect(restored.status).toBe(200);
      expect(restored.body.data.state).toBe('open');
      expect(await sessionCoachIds(target.id)).toEqual([outsider.coach.id]);
    });

    it('also meets the other S7 rules (no hours, appointment)', async () => {
      const noHours = await insertSession('10:00', day(1), [unset], { state: 'CANCELLED' });
      const res = await post(admin, `${SESSIONS_URL}/${noHours.id}/restore`, {});
      expect([res.status, conflictOf(res).type]).toEqual([409, 'AVAILABILITY_NOT_SET']);
    });
  });

  describe('leave and availability never modify a session', () => {
    it('adding, editing and deleting leave, and saving availability, leave the session as it was', async () => {
      const session = await insertSession('10:00', day(0), [alpha, bravo]);
      const snapshot = async () => ({
        row: await prisma.classSession.findUnique({ where: { id: session.id } }),
        coaches: await sessionCoachIds(session.id),
      });
      const before = await snapshot();
      const leaveUrl = `/api/v1/coaches/${alpha.coach.id}/unavailability`;

      const created = await post(admin, leaveUrl, {
        startDate: day(0),
        endDate: day(0),
        reason: 'Sick',
      });
      expect(created.status).toBe(201);
      expect(created.body.data.affectedSessions.map((s) => s.sessionId)).toContain(session.id);
      expect(await snapshot()).toEqual(before);

      const edited = await patch(admin, `${leaveUrl}/${created.body.data.id}`, {
        endDate: day(1),
      });
      expect(edited.status).toBe(200);
      expect(await snapshot()).toEqual(before);

      const days = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        dayOfWeek,
        isAvailable: false,
        slots: [],
      }));
      const saved = await request(app)
        .put(`/api/v1/coaches/${alpha.coach.id}/availability`)
        .set(as(admin))
        .send({ days });
      expect(saved.status).toBe(200);
      expect(await snapshot()).toEqual(before);

      const removed = await request(app)
        .delete(`${leaveUrl}/${created.body.data.id}`)
        .set(as(admin));
      expect(removed.status).toBe(200);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('GET /sessions/coverage', () => {
    const q = (params = {}) =>
      `${COVERAGE_URL}?${new URLSearchParams({ from: day(0), to: day(6), ...params }).toString()}`;

    const seed = async () => {
      const covered = await insertSession('10:00', day(0), [alpha, bravo]);
      const uncovered = await insertSession('12:00', day(0), [alpha]);
      const fine = await insertSession('10:00', day(1), [alpha]); // alpha is back the next day
      const cancelled = await insertSession('15:00', day(0), [alpha], { state: 'CANCELLED' });
      await insertLeave(alpha, day(0), day(0));
      return { covered, uncovered, fine, cancelled };
    };
    const ids = (res) => res.body.data.map((e) => e.sessionId);

    it('lists sessions with a coach on leave: COVERED vs UNCOVERED, sorted, cancelled excluded', async () => {
      const { covered, uncovered, fine, cancelled } = await seed();
      const res = await get(admin, q());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ids(res)).toEqual([covered.id, uncovered.id]);
      expect(ids(res)).not.toContain(fine.id);
      expect(ids(res)).not.toContain(cancelled.id);

      const [first, second] = res.body.data;
      expect(first).toMatchObject({
        sessionId: covered.id,
        classId: cls.id,
        title: cls.name,
        startAt: iso('10:00', day(0)),
        endAt: iso('11:00', day(0)),
        coverage: 'COVERED',
        coveringCoaches: [{ coachId: bravo.coach.id, fullName: 'Sess Bravo' }],
      });
      expect(first.unavailableCoaches).toEqual([
        {
          coachId: alpha.coach.id,
          fullName: 'Sess Alpha',
          leave: {
            id: expect.any(String),
            startDate: day(0),
            endDate: day(0),
            reason: 'Test leave',
          },
        },
      ]);
      expect(second).toMatchObject({ coverage: 'UNCOVERED', coveringCoaches: [] });
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 2 });
    });

    it('an empty range answers an empty list, and the filters narrow it', async () => {
      const { covered } = await seed();
      expect((await get(admin, q({ from: day(3), to: day(4) }))).body.data).toEqual([]);
      expect(ids(await get(owner, q({ coachId: alpha.coach.id })))).toHaveLength(2);
      expect(ids(await get(admin, q({ coachId: bravo.coach.id })))).toEqual([]);
      expect(ids(await get(admin, q({ classId: cls.id })))).toContain(covered.id);
      expect(ids(await get(admin, q({ classId: crypto.randomUUID() })))).toEqual([]);
      const paged = await get(admin, q({ limit: '1', page: '2' }));
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.pagination).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
    });

    it('a coach sees only sessions where they are the one on leave; another coach id is 403', async () => {
      const { covered, uncovered } = await seed();
      expect(ids(await get(alpha.user, q())).sort()).toEqual([covered.id, uncovered.id].sort());
      expect(ids(await get(bravo.user, q()))).toEqual([]); // bravo is on leave nowhere
      expect((await get(alpha.user, q({ coachId: bravo.coach.id }))).status).toBe(403);
      expect((await get(alpha.user, q({ coachId: alpha.coach.id }))).status).toBe(200);
    });

    it('403 for a member, 401 without a token, 400 for bad parameters, 405 for other methods', async () => {
      expect((await get(member, q())).status).toBe(403);
      expect((await request(app).get(q())).status).toBe(401);
      expect((await get(admin, COVERAGE_URL)).status).toBe(400); // no from / to
      expect((await get(admin, q({ from: 'x' }))).status).toBe(400);
      expect((await get(admin, q({ from: day(6), to: day(0) }))).status).toBe(400);
      expect((await get(admin, q({ to: addDaysToDateStr(day(0), 31) }))).status).toBe(400); // 32 days
      expect((await get(admin, q({ coachId: 'x' }))).status).toBe(400);
      expect((await get(admin, q({ state: 'open' }))).status).toBe(400);
      const wrongMethod = await post(admin, COVERAGE_URL, {});
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.allow).toBe('GET');
    });

    it('is not swallowed by /sessions/:id, and GET /sessions keeps its response shape', async () => {
      await seed();
      expect((await get(admin, q())).status).toBe(200); // not 400 "session id must be a UUID"
      const list = await get(
        admin,
        `${SESSIONS_URL}?from=${encodeURIComponent(iso('00:00', day(0)))}&to=${encodeURIComponent(iso('23:00', day(0)))}`,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      list.body.data.forEach((s) => {
        expect(s).not.toHaveProperty('coverage');
        expect(s).not.toHaveProperty('unavailableCoaches');
      });
    });
  });

  describe('generation is not affected', () => {
    it('generateSessionsForWindow still creates sessions for a coach with no hours and a leave', async () => {
      const genClass = await createTestClass(PREFIX, { durationMin: 60, baseCapacity: 10 });
      await prisma.classCoach.create({ data: { classId: genClass.id, coachId: unset.coach.id } });
      // A slot on every weekday, so the 21-day window certainly holds occurrences.
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
        await prisma.classSlot.create({
          data: {
            id: crypto.randomUUID(),
            classId: genClass.id,
            dayOfWeek,
            startDate: dateOnly(TODAY),
            startTime: new Date('1970-01-01T07:00:00.000Z'),
            endTime: new Date('1970-01-01T08:00:00.000Z'),
            capacity: 10,
            active: true,
            coaches: { create: [{ coachId: unset.coach.id }] },
          },
        });
      }
      await insertLeave(unset, addDaysToDateStr(TODAY, 1), addDaysToDateStr(TODAY, 20));

      const result = await generateSessionsForWindow({ classId: genClass.id });
      expect(result.generatedCount).toBeGreaterThan(0);
      expect(result.conflictCount).toBe(0);

      // sessions exist on days when the coach is on leave and has no weekly hours: nothing was skipped
      const onLeaveDay = await prisma.classSession.count({
        where: {
          classId: genClass.id,
          startAt: {
            gte: at('00:00', addDaysToDateStr(TODAY, 2)),
            lt: at('00:00', addDaysToDateStr(TODAY, 20)),
          },
          coaches: { some: { coachId: unset.coach.id } },
        },
      });
      expect(onLeaveDay).toBeGreaterThan(0);
    });
  });
});
