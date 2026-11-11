const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const {
  getTodayInTimezone,
  addDaysToDateStr,
  localDateTimeToUtc,
} = require('../../src/utils/timezone.util');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  createTestClass,
  createTestSession,
  deleteTestClasses,
} = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const COACHES_URL = '/api/v1/coaches';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const CLASS_PREFIX = `test_coach_leave_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const TODAY = getTodayInTimezone(env.FACILITY_TIMEZONE);
const d = (days) => addDaysToDateStr(TODAY, days);
const dateOnly = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);

describe('coach unavailability: /api/v1/coaches/:coachId/unavailability', () => {
  const testData = createTestData('coach_leave');
  let app;
  let admin;
  let owner;
  let member;
  let alpha; // { user, coach } - the coach the leave is added to
  let bravo; // another coach
  let charlie; // a third coach

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    alpha = await testData.createCoach({ user: { fullName: 'Leave Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Leave Bravo' } });
    charlie = await testData.createCoach({ user: { fullName: 'Leave Charlie' } });
  });

  const coachIds = () => [alpha, bravo, charlie].map((c) => c.coach.id);
  const coachUserIds = () => [alpha, bravo, charlie].map((c) => c.user.id);

  // Isolation: every test starts without leave, sessions or audit rows of these coaches.
  afterEach(async () => {
    await deleteTestClasses(CLASS_PREFIX);
    await prisma.coachUnavailability.deleteMany({ where: { coachId: { in: coachIds() } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: coachUserIds() } } });
  });

  afterAll(async () => {
    // class_session_coaches.coachId is RESTRICT: sessions go before the coaches.
    await deleteTestClasses(CLASS_PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const base = (coach) => `${COACHES_URL}/${coach.coach.id}/unavailability`;
  const itemUrl = (coach, id) => `${base(coach)}/${id}`;
  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const get = (caller, url) => request(app).get(url).set(as(caller));
  const post = (caller, url, body) => request(app).post(url).set(as(caller)).send(body);
  const patch = (caller, url, body) => request(app).patch(url).set(as(caller)).send(body);
  const del = (caller, url) => request(app).delete(url).set(as(caller));

  const validBody = (overrides = {}) => ({
    startDate: d(10),
    endDate: d(12),
    reason: 'Sick leave',
    ...overrides,
  });

  const insertLeave = (coach, startDate, endDate, extra = {}) =>
    prisma.coachUnavailability.create({
      data: {
        id: crypto.randomUUID(),
        coachId: coach.coach.id,
        startDate: dateOnly(startDate),
        endDate: dateOnly(endDate),
        reason: 'Seeded leave',
        ...extra,
      },
    });

  const dbLeave = (coach) =>
    prisma.coachUnavailability.findMany({
      where: { coachId: coach.coach.id },
      orderBy: { startDate: 'asc' },
    });

  // A session of its own class on facility date `dateStr` at `time`, with the given coaches.
  const makeSession = async (dateStr, time, coaches, overrides = {}) => {
    const cls = await createTestClass(CLASS_PREFIX);
    const session = await createTestSession(cls.id, {
      startAt: localDateTimeToUtc(dateStr, time, env.FACILITY_TIMEZONE),
      ...overrides,
    });
    await prisma.classSessionCoach.createMany({
      data: coaches.map((c) => ({ sessionId: session.id, coachId: c.coach.id })),
    });
    return { session, cls };
  };

  const dbSessionState = async () => {
    const sessions = await prisma.classSession.findMany({
      where: { class: { name: { startsWith: CLASS_PREFIX } } },
      include: { coaches: { orderBy: { coachId: 'asc' } } },
      orderBy: { startAt: 'asc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      state: s.state,
      version: s.version,
      cancelReason: s.cancelReason,
      coaches: s.coaches.map((c) => c.coachId),
    }));
  };

  describe('CRUD round trip', () => {
    it('creates, lists, edits and deletes a leave', async () => {
      const created = await post(
        admin,
        base(alpha),
        validBody({ reason: '  Sick leave ', note: '' }),
      );

      expect(created.status).toBe(201);
      expect(created.body.success).toBe(true);
      expect(created.body.message).toBe(Messages.UNAVAILABILITY_CREATED_SUCCESS);
      const leave = created.body.data;
      expect(leave).toMatchObject({
        coachId: alpha.coach.id,
        startDate: d(10),
        endDate: d(12),
        reason: 'Sick leave',
        note: null,
        affectedSessions: [],
        affectedTotal: 0,
      });
      expect(leave.startDate).toMatch(DATE_ONLY);
      expect(leave.createdAt).toMatch(ISO_UTC);
      expect(leave.updatedAt).toMatch(ISO_UTC);
      expect(await dbLeave(alpha)).toHaveLength(1);

      const listed = await get(admin, base(alpha));
      expect(listed.status).toBe(200);
      expect(listed.body.data.map((row) => row.id)).toEqual([leave.id]);
      expect(listed.body.data[0].note).toBeNull();
      expect(listed.body.data[0]).not.toHaveProperty('affectedSessions');
      expect(listed.body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });

      const edited = await patch(owner, itemUrl(alpha, leave.id), {
        endDate: d(14),
        note: ' back on the 15th ',
      });
      expect(edited.status).toBe(200);
      expect(edited.body.message).toBe(Messages.UNAVAILABILITY_UPDATED_SUCCESS);
      expect(edited.body.data).toMatchObject({
        id: leave.id,
        startDate: d(10),
        endDate: d(14),
        reason: 'Sick leave',
        note: 'back on the 15th',
        affectedTotal: 0,
      });

      const cleared = await patch(admin, itemUrl(alpha, leave.id), { note: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.note).toBeNull();

      const removed = await del(admin, itemUrl(alpha, leave.id));
      expect(removed.status).toBe(200);
      expect(removed.body.message).toBe(Messages.UNAVAILABILITY_DELETED_SUCCESS);
      expect(removed.body.data).toEqual({ id: leave.id });
      expect(await dbLeave(alpha)).toHaveLength(0);

      const after = await get(admin, base(alpha));
      expect(after.body.data).toEqual([]);
      expect(after.body.pagination.total).toBe(0);
    });

    it('accepts a leave that starts today and a one-day leave', async () => {
      const res = await post(admin, base(alpha), validBody({ startDate: TODAY, endDate: TODAY }));
      expect(res.status).toBe(201);
      expect(res.body.data.startDate).toBe(TODAY);
    });
  });

  describe('POST validation', () => {
    it('rejects missing required fields with one error per field', async () => {
      const res = await post(admin, base(alpha), {});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e) => e.field).sort()).toEqual([
        'endDate',
        'reason',
        'startDate',
      ]);
    });

    it('rejects an end date before the start date', async () => {
      const res = await post(admin, base(alpha), validBody({ startDate: d(12), endDate: d(10) }));
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        { field: 'endDate', message: Messages.UNAVAILABILITY_END_BEFORE_START },
      ]);
      expect(await dbLeave(alpha)).toHaveLength(0);
    });

    it('rejects a start date in the past (facility date) and writes nothing', async () => {
      const res = await post(admin, base(alpha), validBody({ startDate: d(-1), endDate: d(3) }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toEqual([
        { field: 'startDate', message: Messages.UNAVAILABILITY_START_IN_PAST(TODAY) },
      ]);
      expect(await dbLeave(alpha)).toHaveLength(0);
      expect(await prisma.auditLog.count({ where: { userId: alpha.user.id } })).toBe(0);
    });

    it('rejects a blank reason, a too long reason, a bad date and unknown fields', async () => {
      const blank = await post(admin, base(alpha), validBody({ reason: '   ' }));
      expect(blank.status).toBe(400);
      expect(blank.body.errors[0].field).toBe('reason');

      const long = await post(admin, base(alpha), validBody({ reason: 'x'.repeat(201) }));
      expect(long.status).toBe(400);

      const badDate = await post(admin, base(alpha), validBody({ startDate: '2026-02-30' }));
      expect(badDate.status).toBe(400);
      expect(badDate.body.errors[0].field).toBe('startDate');

      const unknown = await post(admin, base(alpha), validBody({ category: 'sick' }));
      expect(unknown.status).toBe(400);
    });

    it('rejects a missing body', async () => {
      const res = await request(app).post(base(alpha)).set(as(admin));
      expect(res.status).toBe(400);
    });
  });

  describe('overlap rules', () => {
    it('rejects a leave that shares a date with an existing one (409, names the range)', async () => {
      await insertLeave(alpha, d(10), d(12));

      // d(12) is the last day of the existing leave: inclusive dates share it.
      const res = await post(admin, base(alpha), validBody({ startDate: d(12), endDate: d(14) }));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNAVAILABILITY_OVERLAP');
      expect(res.body.message).toBe(Messages.UNAVAILABILITY_OVERLAP_DETAIL(d(10), d(12)));
      expect(res.body.details.conflict).toMatchObject({ startDate: d(10), endDate: d(12) });
      expect(await dbLeave(alpha)).toHaveLength(1);
    });

    it('rejects a leave that contains, or is contained by, an existing one', async () => {
      await insertLeave(alpha, d(10), d(20));
      const inside = await post(
        admin,
        base(alpha),
        validBody({ startDate: d(12), endDate: d(13) }),
      );
      const around = await post(admin, base(alpha), validBody({ startDate: d(5), endDate: d(30) }));
      expect(inside.status).toBe(409);
      expect(around.status).toBe(409);
    });

    it('accepts a leave on the day after an existing one (no shared date)', async () => {
      await insertLeave(alpha, d(10), d(12));
      const res = await post(admin, base(alpha), validBody({ startDate: d(13), endDate: d(14) }));
      expect(res.status).toBe(201);
      expect(await dbLeave(alpha)).toHaveLength(2);
    });

    it('does not compare with the leave of another coach', async () => {
      await insertLeave(bravo, d(10), d(12));
      const res = await post(admin, base(alpha), validBody());
      expect(res.status).toBe(201);
    });

    it('PATCH excludes the row being edited from the overlap check', async () => {
      const own = await insertLeave(alpha, d(10), d(12));
      const same = await patch(admin, itemUrl(alpha, own.id), { startDate: d(10), endDate: d(12) });
      expect(same.status).toBe(200);
      const extended = await patch(admin, itemUrl(alpha, own.id), { endDate: d(15) });
      expect(extended.status).toBe(200);
      expect(extended.body.data.endDate).toBe(d(15));
    });

    it('PATCH rejects a change that now overlaps another leave (409) and keeps the row as it was', async () => {
      await insertLeave(alpha, d(10), d(12));
      const second = await insertLeave(alpha, d(20), d(22));

      const res = await patch(admin, itemUrl(alpha, second.id), { startDate: d(12) });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNAVAILABILITY_OVERLAP');
      expect(res.body.message).toBe(Messages.UNAVAILABILITY_OVERLAP_DETAIL(d(10), d(12)));
      const rows = await dbLeave(alpha);
      expect(rows[1].startDate.toISOString().slice(0, 10)).toBe(d(20));
    });

    it('two simultaneous creates for the same dates: one 201 and one 409', async () => {
      const results = await Promise.all([
        post(admin, base(alpha), validBody()),
        post(owner, base(alpha), validBody()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await dbLeave(alpha)).toHaveLength(1);
    });
  });

  describe('PATCH rules', () => {
    it('validates the MERGED dates: only endDate sent, before the stored start', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      const res = await patch(admin, itemUrl(alpha, row.id), { endDate: d(8) });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        { field: 'endDate', message: Messages.UNAVAILABILITY_END_BEFORE_START },
      ]);
    });

    it('validates the MERGED dates: only startDate sent, after the stored end', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      const res = await patch(admin, itemUrl(alpha, row.id), { startDate: d(13) });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('endDate');
    });

    it('rejects moving a leave that has not started into the past', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      const res = await patch(admin, itemUrl(alpha, row.id), { startDate: d(-2) });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        { field: 'startDate', message: Messages.UNAVAILABILITY_START_IN_PAST(TODAY) },
      ]);
    });

    it('rejects an empty patch, an unknown field and a malformed leave id', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      const empty = await patch(admin, itemUrl(alpha, row.id), {});
      expect(empty.status).toBe(400);
      const unknown = await patch(admin, itemUrl(alpha, row.id), { coachId: bravo.coach.id });
      expect(unknown.status).toBe(400);
      const badId = await patch(admin, itemUrl(alpha, 'not-a-uuid'), { reason: 'x' });
      expect(badId.status).toBe(400);
      expect(badId.body.code).toBe('VALIDATION_ERROR');
    });

    it('started leave: startDate is locked, endDate can be extended or shortened to today, reason and note can change', async () => {
      const row = await insertLeave(alpha, d(-2), d(3));

      const locked = await patch(admin, itemUrl(alpha, row.id), { startDate: d(-1) });
      expect(locked.status).toBe(400);
      expect(locked.body.errors).toEqual([
        { field: 'startDate', message: Messages.UNAVAILABILITY_START_LOCKED },
      ]);

      const sameStart = await patch(admin, itemUrl(alpha, row.id), {
        startDate: d(-2),
        endDate: d(9),
      });
      expect(sameStart.status).toBe(200);
      expect(sameStart.body.data).toMatchObject({ startDate: d(-2), endDate: d(9) });

      const shortened = await patch(admin, itemUrl(alpha, row.id), { endDate: TODAY });
      expect(shortened.status).toBe(200);
      expect(shortened.body.data.endDate).toBe(TODAY);

      const intoPast = await patch(admin, itemUrl(alpha, row.id), { endDate: d(-1) });
      expect(intoPast.status).toBe(400);
      expect(intoPast.body.errors[0]).toEqual({
        field: 'endDate',
        message: Messages.UNAVAILABILITY_END_IN_PAST(TODAY),
      });

      const text = await patch(admin, itemUrl(alpha, row.id), {
        reason: 'Surgery',
        note: 'ward 3',
      });
      expect(text.status).toBe(200);
      expect(text.body.data).toMatchObject({ reason: 'Surgery', note: 'ward 3' });
    });

    it('a leave that has ended cannot be edited (409 UNAVAILABILITY_PAST_IMMUTABLE)', async () => {
      const row = await insertLeave(alpha, d(-10), d(-5));
      const res = await patch(admin, itemUrl(alpha, row.id), { reason: 'Changed' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNAVAILABILITY_PAST_IMMUTABLE');
      expect((await dbLeave(alpha))[0].reason).toBe('Seeded leave');
    });
  });

  describe('DELETE rules', () => {
    it('deletes an ongoing leave and a future leave', async () => {
      const ongoing = await insertLeave(alpha, d(-2), d(3));
      const future = await insertLeave(alpha, d(10), d(12));
      expect((await del(admin, itemUrl(alpha, ongoing.id))).status).toBe(200);
      expect((await del(admin, itemUrl(alpha, future.id))).status).toBe(200);
      expect(await dbLeave(alpha)).toHaveLength(0);
    });

    it('does not delete a leave that has ended (409) and keeps the row', async () => {
      const ended = await insertLeave(alpha, d(-10), d(-5));
      const res = await del(admin, itemUrl(alpha, ended.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNAVAILABILITY_PAST_IMMUTABLE');
      expect(await dbLeave(alpha)).toHaveLength(1);
    });
  });

  describe('404s', () => {
    it('answers 404 COACH_NOT_FOUND for an unknown coach on every operation', async () => {
      const url = `${COACHES_URL}/${MISSING_ID}/unavailability`;
      const calls = [
        get(admin, url),
        post(admin, url, validBody()),
        patch(admin, `${url}/${MISSING_ID}`, { reason: 'x' }),
        del(admin, `${url}/${MISSING_ID}`),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('COACH_NOT_FOUND');
      }
    });

    it('answers 404 UNAVAILABILITY_NOT_FOUND for an unknown leave id', async () => {
      const edit = await patch(admin, itemUrl(alpha, MISSING_ID), { reason: 'x' });
      const remove = await del(admin, itemUrl(alpha, MISSING_ID));
      for (const res of [edit, remove]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('UNAVAILABILITY_NOT_FOUND');
      }
    });

    it("answers 404 for another coach's leave id and leaves that row untouched", async () => {
      const bravoLeave = await insertLeave(bravo, d(10), d(12));

      const edit = await patch(admin, itemUrl(alpha, bravoLeave.id), { reason: 'Hijacked' });
      const remove = await del(admin, itemUrl(alpha, bravoLeave.id));

      for (const res of [edit, remove]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('UNAVAILABILITY_NOT_FOUND');
      }
      const rows = await dbLeave(bravo);
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('Seeded leave');
    });

    it('answers 400 for a coach id that is not a UUID', async () => {
      const res = await get(admin, `${COACHES_URL}/not-a-uuid/unavailability`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('roles and methods', () => {
    it('lets a coach read their own leave', async () => {
      await insertLeave(alpha, d(10), d(12));
      const res = await get(alpha.user, base(alpha));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("answers 403 when a coach reads another coach's leave", async () => {
      const res = await get(bravo.user, base(alpha));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('answers 403 to a coach on every write, for their own profile too', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      for (const target of [alpha, bravo]) {
        const create = await post(
          alpha.user,
          base(target),
          validBody({ startDate: d(40), endDate: d(41) }),
        );
        const edit = await patch(alpha.user, itemUrl(target, row.id), { reason: 'x' });
        const remove = await del(alpha.user, itemUrl(target, row.id));
        for (const res of [create, edit, remove]) {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('FORBIDDEN');
        }
      }
      const rows = await dbLeave(alpha);
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('Seeded leave');
    });

    it('answers 403 to a member on every operation', async () => {
      const row = await insertLeave(alpha, d(10), d(12));
      const calls = [
        get(member, base(alpha)),
        post(member, base(alpha), validBody({ startDate: d(40), endDate: d(41) })),
        patch(member, itemUrl(alpha, row.id), { reason: 'x' }),
        del(member, itemUrl(alpha, row.id)),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    });

    it('answers 401 without a token', async () => {
      const calls = [
        request(app).get(base(alpha)),
        request(app).post(base(alpha)).send(validBody()),
        request(app).patch(itemUrl(alpha, MISSING_ID)).send({ reason: 'x' }),
        request(app).delete(itemUrl(alpha, MISSING_ID)),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      }
    });

    it('answers 405 with the right Allow header for other methods', async () => {
      const onCollection = await request(app).put(base(alpha)).set(as(admin)).send({});
      expect(onCollection.status).toBe(405);
      expect(onCollection.headers.allow).toBe('GET, POST');
      expect(onCollection.body.code).toBe('METHOD_NOT_ALLOWED');

      const onItem = await request(app).get(itemUrl(alpha, MISSING_ID)).set(as(admin));
      expect(onItem.status).toBe(405);
      expect(onItem.headers.allow).toBe('PATCH, DELETE');
    });
  });

  describe('GET list', () => {
    it('sorts by startDate and filters by from / to (leave that touches the window)', async () => {
      const late = await insertLeave(alpha, d(40), d(41));
      const first = await insertLeave(alpha, d(5), d(6));
      const middle = await insertLeave(alpha, d(20), d(22));

      const all = await get(admin, base(alpha));
      expect(all.body.data.map((r) => r.id)).toEqual([first.id, middle.id, late.id]);

      const fromOnly = await get(admin, `${base(alpha)}?from=${d(21)}`);
      expect(fromOnly.body.data.map((r) => r.id)).toEqual([middle.id, late.id]);

      const toOnly = await get(admin, `${base(alpha)}?to=${d(10)}`);
      expect(toOnly.body.data.map((r) => r.id)).toEqual([first.id]);

      const window = await get(admin, `${base(alpha)}?from=${d(6)}&to=${d(20)}`);
      expect(window.body.data.map((r) => r.id)).toEqual([first.id, middle.id]);

      const gap = await get(admin, `${base(alpha)}?from=${d(7)}&to=${d(19)}`);
      expect(gap.body.data).toEqual([]);
    });

    it('paginates', async () => {
      await insertLeave(alpha, d(5), d(6));
      await insertLeave(alpha, d(20), d(22));
      const last = await insertLeave(alpha, d(40), d(41));

      const res = await get(admin, `${base(alpha)}?page=2&limit=2`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((r) => r.id)).toEqual([last.id]);
      expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('returns only the leave of that coach', async () => {
      await insertLeave(bravo, d(5), d(6));
      const mine = await insertLeave(alpha, d(7), d(8));
      const res = await get(admin, base(alpha));
      expect(res.body.data.map((r) => r.id)).toEqual([mine.id]);
    });

    it('rejects a bad date, from after to, a bad page and an unknown parameter with 400', async () => {
      for (const query of [
        'from=2026-02-30',
        `from=${d(5)}&to=${d(1)}`,
        'page=0',
        'limit=101',
        'status=x',
      ]) {
        const res = await get(admin, `${base(alpha)}?${query}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('audit rows', () => {
    it('writes one row per create, update and delete with a short summary', async () => {
      const created = await post(admin, base(alpha), validBody());
      const id = created.body.data.id;
      await patch(owner, itemUrl(alpha, id), { endDate: d(14) });
      await del(admin, itemUrl(alpha, id));

      const rows = await prisma.auditLog.findMany({
        where: { userId: alpha.user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        AuditAction.COACH_UNAVAILABILITY_CREATED,
        AuditAction.COACH_UNAVAILABILITY_UPDATED,
        AuditAction.COACH_UNAVAILABILITY_DELETED,
      ]);
      expect(rows[0]).toMatchObject({ actorId: admin.id, actorRole: Role.ADMIN });
      expect(rows[0].details).toEqual({
        coachId: alpha.coach.id,
        unavailabilityId: id,
        startDate: d(10),
        endDate: d(12),
        reason: 'Sick leave',
      });
      expect(rows[1]).toMatchObject({ actorId: owner.id, actorRole: Role.OWNER });
      expect(rows[1].details).toEqual({
        coachId: alpha.coach.id,
        unavailabilityId: id,
        before: { startDate: d(10), endDate: d(12) },
        after: { startDate: d(10), endDate: d(14) },
        changed: ['endDate'],
      });
      expect(rows[2].details).toEqual({
        coachId: alpha.coach.id,
        unavailabilityId: id,
        startDate: d(10),
        endDate: d(14),
      });
    });

    it('writes no audit row for a rejected request', async () => {
      await insertLeave(alpha, d(10), d(12));
      await post(admin, base(alpha), validBody()); // 409
      await post(admin, base(alpha), validBody({ startDate: d(-3), endDate: d(-1) })); // 400
      await post(alpha.user, base(alpha), validBody({ startDate: d(40), endDate: d(41) })); // 403
      expect(await prisma.auditLog.count({ where: { userId: alpha.user.id } })).toBe(0);
    });
  });

  describe('affected sessions and no side effects', () => {
    it('lists the upcoming sessions of the coach in the range with COVERED / UNCOVERED, and skips the rest', async () => {
      // Inside the leave, alpha assigned:
      const covered = await makeSession(d(10), '09:00', [alpha, bravo]); // bravo is free
      const solo = await makeSession(d(10), '11:00', [alpha]); // nobody else
      const otherOnLeave = await makeSession(d(11), '09:00', [alpha, charlie]); // charlie on leave d(11)
      // Not listed:
      await makeSession(d(11), '15:00', [alpha], { state: 'CANCELLED' });
      await makeSession(d(30), '09:00', [alpha]); // outside the range
      await makeSession(d(10), '12:00', [bravo]); // alpha not assigned
      await insertLeave(charlie, d(11), d(11));

      const res = await post(admin, base(alpha), validBody({ startDate: d(10), endDate: d(12) }));

      expect(res.status).toBe(201);
      expect(res.body.data.affectedTotal).toBe(3);
      expect(res.body.data.affectedSessions.map((s) => [s.sessionId, s.coverage])).toEqual([
        [covered.session.id, 'COVERED'],
        [solo.session.id, 'UNCOVERED'],
        [otherOnLeave.session.id, 'UNCOVERED'],
      ]);
      expect(res.body.data.affectedSessions[0]).toEqual({
        sessionId: covered.session.id,
        classId: covered.cls.id,
        title: covered.cls.name,
        startAt: covered.session.startAt.toISOString(),
        endAt: covered.session.endAt.toISOString(),
        coverage: 'COVERED',
      });
      expect(res.body.data.affectedSessions[0].startAt).toMatch(ISO_UTC);
    });

    it('turns a session UNCOVERED when the only other coach is on leave that day', async () => {
      const shared = await makeSession(d(10), '09:00', [alpha, bravo]);
      await insertLeave(bravo, d(9), d(10));

      const res = await post(admin, base(alpha), validBody({ startDate: d(10), endDate: d(10) }));

      expect(res.body.data.affectedSessions).toEqual([
        expect.objectContaining({ sessionId: shared.session.id, coverage: 'UNCOVERED' }),
      ]);
    });

    it('PATCH reports the sessions of the new range', async () => {
      const inFirst = await makeSession(d(10), '09:00', [alpha]);
      const inExtension = await makeSession(d(14), '09:00', [alpha, bravo]);
      const row = await insertLeave(alpha, d(10), d(12));

      const res = await patch(admin, itemUrl(alpha, row.id), { endDate: d(15) });

      expect(res.status).toBe(200);
      expect(res.body.data.affectedTotal).toBe(2);
      expect(res.body.data.affectedSessions.map((s) => [s.sessionId, s.coverage])).toEqual([
        [inFirst.session.id, 'UNCOVERED'],
        [inExtension.session.id, 'COVERED'],
      ]);
    });

    it('returns an empty list when the coach has no session in the range', async () => {
      await makeSession(d(30), '09:00', [alpha]);
      const res = await post(admin, base(alpha), validBody());
      expect(res.body.data.affectedSessions).toEqual([]);
      expect(res.body.data.affectedTotal).toBe(0);
    });

    it('does not cancel, reassign or change any session when leave is added, edited or removed', async () => {
      await makeSession(d(10), '09:00', [alpha, bravo]);
      await makeSession(d(11), '09:00', [alpha]);
      await makeSession(d(11), '12:00', [alpha], { state: 'CANCELLED', cancelReason: 'Test' });
      const before = await dbSessionState();
      expect(before).toHaveLength(3);

      const created = await post(
        admin,
        base(alpha),
        validBody({ startDate: d(10), endDate: d(12) }),
      );
      expect(await dbSessionState()).toEqual(before);

      const id = created.body.data.id;
      await patch(admin, itemUrl(alpha, id), { endDate: d(20), reason: 'Extended' });
      expect(await dbSessionState()).toEqual(before);

      await del(admin, itemUrl(alpha, id));
      expect(await dbSessionState()).toEqual(before);
    });
  });
});
