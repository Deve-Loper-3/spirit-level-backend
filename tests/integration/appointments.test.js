const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { openAllWeek } = require('../helpers/coachSchedule.helper');
const {
  createTestClass,
  createTestSession,
  deleteTestClasses,
} = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const URL = '/api/v1/appointments';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PREFIX = `test_apt_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days, hour = 6) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

describe('appointments: /api/v1/appointments', () => {
  const testData = createTestData('apt');
  let app;
  let admin;
  let owner;
  let memberA;
  let memberB;
  let alpha; // { user, coach }
  let bravo;
  let type;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    memberA = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Alpha' });
    memberB = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Bravo' });
    alpha = await testData.createCoach({ user: { fullName: 'Coach Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Coach Bravo' } });
    // Strict availability (S7): both coaches work every day, all day, so these tests only meet the
    // conflict rules they set up on purpose (the conflict cases live in coachSchedule.conflicts.test.js).
    await openAllWeek(alpha.coach.id);
    await openAllWeek(bravo.coach.id);
    type = await prisma.appointmentType.create({
      data: {
        id: crypto.randomUUID(),
        name: `${PREFIX}PT 60`,
        durationMin: 60,
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      },
    });
  });

  const userIds = () => [admin, owner, memberA, memberB, alpha.user, bravo.user].map((u) => u.id);

  afterEach(async () => {
    await prisma.appointment.deleteMany({ where: { appointmentTypeId: type.id } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds() } }, { userId: { in: userIds() } }] },
    });
    await deleteTestClasses(PREFIX);
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { appointmentTypeId: type.id } });
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.appointmentType.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const get = (caller, url) => request(app).get(url).set(as(caller));
  const post = (caller, url, body) => request(app).post(url).set(as(caller)).send(body);

  const bookBody = (overrides = {}) => ({
    coachId: alpha.coach.id,
    memberId: memberA.id,
    appointmentTypeId: type.id,
    startAt: inDays(7).toISOString(),
    ...overrides,
  });

  const book = async (overrides = {}, caller = admin) => {
    const res = await post(caller, URL, bookBody(overrides));
    expect(res.status).toBe(201);
    return res.body.data;
  };

  describe('POST /appointments', () => {
    it('books: endAt, buffer snapshots, BOOKED, version 1, explicit nulls, names, audit row', async () => {
      const startAt = inDays(7);
      const res = await post(admin, URL, bookBody({ startAt: startAt.toISOString() }));
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        coachId: alpha.coach.id,
        coachName: 'Coach Alpha',
        memberId: memberA.id,
        memberName: 'Member Alpha',
        appointmentTypeId: type.id,
        appointmentTypeName: type.name,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
        state: 'BOOKED',
        cancelledAt: null,
        version: 1,
      });
      expect(res.body.data.createdAt).toMatch(ISO_UTC);

      const audit = await prisma.auditLog.findMany({
        where: { action: AuditAction.APPOINTMENT_CREATED, actorId: admin.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(memberA.id);
      expect(audit[0].details).toMatchObject({
        appointmentId: res.body.data.id,
        coachId: alpha.coach.id,
      });
    });

    it('accepts an offset start and stores the same UTC instant; OWNER can book', async () => {
      const res = await post(owner, URL, bookBody({ startAt: '2030-01-01T10:00:00+04:00' }));
      expect(res.status).toBe(201);
      expect(res.body.data.startAt).toBe('2030-01-01T06:00:00.000Z');
    });

    it('editing the type afterwards does not change the appointment', async () => {
      const created = await book();
      await prisma.appointmentType.update({
        where: { id: type.id },
        data: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, name: `${PREFIX}renamed` },
      });
      try {
        const res = await get(admin, `${URL}/${created.id}`);
        expect(res.body.data).toMatchObject({
          startAt: created.startAt,
          endAt: created.endAt,
          bufferBeforeMin: 5,
          bufferAfterMin: 10,
        });
      } finally {
        await prisma.appointmentType.update({
          where: { id: type.id },
          data: { durationMin: 60, bufferBeforeMin: 5, bufferAfterMin: 10, name: `${PREFIX}PT 60` },
        });
      }
    });

    it('400 for a start in the past (field startAt) and for bad bodies', async () => {
      const past = await post(admin, URL, bookBody({ startAt: inDays(-1).toISOString() }));
      expect(past.status).toBe(400);
      expect(past.body.code).toBe('VALIDATION_ERROR');
      expect(past.body.errors[0].field).toBe('startAt');

      expect((await post(admin, URL, bookBody({ startAt: '2030-01-01T10:00:00' }))).status).toBe(
        400,
      );
      expect((await post(admin, URL, bookBody({ coachId: 'x' }))).status).toBe(400);
      expect(
        (await post(admin, URL, { ...bookBody(), endAt: inDays(8).toISOString() })).status,
      ).toBe(400);
      expect((await post(admin, URL, {})).body.errors).toHaveLength(4);
    });

    it('404 for an unknown coach, member or type; a COACH user is not a member', async () => {
      const coach = await post(admin, URL, bookBody({ coachId: MISSING_ID }));
      expect([coach.status, coach.body.code]).toEqual([404, 'COACH_NOT_FOUND']);
      const unknownMember = await post(admin, URL, bookBody({ memberId: MISSING_ID }));
      expect([unknownMember.status, unknownMember.body.code]).toEqual([404, 'MEMBER_NOT_FOUND']);
      const notMember = await post(admin, URL, bookBody({ memberId: bravo.user.id }));
      expect([notMember.status, notMember.body.code]).toEqual([404, 'MEMBER_NOT_FOUND']);
      const unknownType = await post(admin, URL, bookBody({ appointmentTypeId: MISSING_ID }));
      expect([unknownType.status, unknownType.body.code]).toEqual([
        404,
        'APPOINTMENT_TYPE_NOT_FOUND',
      ]);
    });

    it('409 for an inactive type, an inactive coach and a member that is not active', async () => {
      await prisma.appointmentType.update({ where: { id: type.id }, data: { isActive: false } });
      try {
        const res = await post(admin, URL, bookBody());
        expect([res.status, res.body.code]).toEqual([409, 'APPOINTMENT_TYPE_INACTIVE']);
      } finally {
        await prisma.appointmentType.update({ where: { id: type.id }, data: { isActive: true } });
      }

      await prisma.coach.update({ where: { id: bravo.coach.id }, data: { status: 'INACTIVE' } });
      try {
        const res = await post(admin, URL, bookBody({ coachId: bravo.coach.id }));
        expect([res.status, res.body.code]).toEqual([409, 'COACH_INACTIVE']);
      } finally {
        await prisma.coach.update({ where: { id: bravo.coach.id }, data: { status: 'ACTIVE' } });
      }

      await prisma.user.update({ where: { id: memberB.id }, data: { status: 'DISABLED' } });
      try {
        const res = await post(admin, URL, bookBody({ memberId: memberB.id }));
        expect([res.status, res.body.code]).toEqual([409, 'MEMBER_NOT_ACTIVE']);
      } finally {
        await prisma.user.update({ where: { id: memberB.id }, data: { status: 'ACTIVE' } });
      }
      expect(await prisma.appointment.count({ where: { appointmentTypeId: type.id } })).toBe(0);
    });

    it('403 for a coach and a member, 401 without a token', async () => {
      expect((await post(alpha.user, URL, bookBody())).status).toBe(403);
      expect((await post(memberA, URL, bookBody())).status).toBe(403);
      expect((await request(app).post(URL).send(bookBody())).status).toBe(401);
    });

    it('leaves class sessions untouched', async () => {
      const cls = await createTestClass(PREFIX);
      const session = await createTestSession(cls.id, { startAt: inDays(7) });
      await prisma.classSessionCoach.create({
        data: { sessionId: session.id, coachId: alpha.coach.id },
      });
      const before = await prisma.classSession.findUnique({ where: { id: session.id } });

      // Two hours after the session: it must not collide with it (S7), and must not change it.
      await book({ startAt: inDays(7, 9).toISOString() });

      const after = await prisma.classSession.findUnique({ where: { id: session.id } });
      expect(after).toEqual(before);
      expect(await prisma.classSessionCoach.count({ where: { sessionId: session.id } })).toBe(1);
    });
  });

  describe('POST /appointments/:id/cancel', () => {
    it('cancels: CANCELLED, cancelledAt set, version + 1, audit row', async () => {
      const created = await book();
      const res = await post(admin, `${URL}/${created.id}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: created.id, state: 'CANCELLED', version: 2 });
      expect(res.body.data.cancelledAt).toMatch(ISO_UTC);

      const audit = await prisma.auditLog.findMany({
        where: { action: AuditAction.APPOINTMENT_CANCELLED, actorId: admin.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({ appointmentId: created.id });
    });

    it('a second cancel is 409 APPOINTMENT_ALREADY_CANCELLED and changes nothing', async () => {
      const created = await book();
      await post(admin, `${URL}/${created.id}/cancel`);
      const again = await post(owner, `${URL}/${created.id}/cancel`);
      expect([again.status, again.body.code]).toEqual([409, 'APPOINTMENT_ALREADY_CANCELLED']);
      const stored = await prisma.appointment.findUnique({ where: { id: created.id } });
      expect(stored.version).toBe(2);
    });

    it('an appointment that already started is 409 APPOINTMENT_PAST_IMMUTABLE', async () => {
      const startAt = new Date(Date.now() - 30 * 60 * 1000);
      const row = await prisma.appointment.create({
        data: {
          id: crypto.randomUUID(),
          coachId: alpha.coach.id,
          memberId: memberA.id,
          appointmentTypeId: type.id,
          startAt,
          endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
        },
      });
      const res = await post(admin, `${URL}/${row.id}/cancel`);
      expect([res.status, res.body.code]).toEqual([409, 'APPOINTMENT_PAST_IMMUTABLE']);
    });

    it('404 unknown, 400 bad id, 403 for coach and member', async () => {
      const created = await book();
      expect((await post(admin, `${URL}/${MISSING_ID}/cancel`)).body.code).toBe(
        'APPOINTMENT_NOT_FOUND',
      );
      expect((await post(admin, `${URL}/nope/cancel`)).status).toBe(400);
      expect((await post(alpha.user, `${URL}/${created.id}/cancel`)).status).toBe(403);
      expect((await post(memberA, `${URL}/${created.id}/cancel`)).status).toBe(403);
    });
  });

  describe('GET /appointments', () => {
    const seed = async () => {
      const a1 = await book({ startAt: inDays(10).toISOString() });
      const a2 = await book({ startAt: inDays(8).toISOString(), memberId: memberB.id });
      const a3 = await book({
        startAt: inDays(9).toISOString(),
        coachId: bravo.coach.id,
        memberId: memberA.id,
      });
      await post(admin, `${URL}/${a3.id}/cancel`);
      return { a1, a2, a3 };
    };
    const ids = (res) => res.body.data.map((a) => a.id);

    it('manager: sorted by startAt, filters and pagination', async () => {
      const { a1, a2, a3 } = await seed();
      const mine = `limit=100&from=${inDays(1).toISOString()}`;

      const all = await get(admin, `${URL}?${mine}&coachId=${alpha.coach.id}`);
      expect(ids(all)).toEqual([a2.id, a1.id]);
      expect(all.body.pagination).toMatchObject({ page: 1, limit: 100, total: 2, totalPages: 1 });

      expect(ids(await get(owner, `${URL}?${mine}&memberId=${memberB.id}`))).toEqual([a2.id]);
      expect(
        ids(await get(admin, `${URL}?${mine}&state=CANCELLED&memberId=${memberA.id}`)),
      ).toEqual([a3.id]);
      expect(
        ids(
          await get(
            admin,
            `${URL}?coachId=${alpha.coach.id}&state=BOOKED&from=${inDays(9).toISOString()}&to=${inDays(11).toISOString()}`,
          ),
        ),
      ).toEqual([a1.id]);

      const page2 = await get(admin, `${URL}?coachId=${alpha.coach.id}&limit=1&page=2`);
      expect(ids(page2)).toEqual([a1.id]);
      expect(page2.body.pagination).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
    });

    it('coach: only their own appointments; another coach id is 403', async () => {
      const { a1, a2, a3 } = await seed();
      const own = await get(alpha.user, `${URL}?limit=100`);
      expect(ids(own).sort()).toEqual([a1.id, a2.id].sort());
      expect(ids(await get(bravo.user, `${URL}?limit=100`))).toEqual([a3.id]);
      expect((await get(alpha.user, `${URL}?coachId=${bravo.coach.id}`)).status).toBe(403);
      expect((await get(alpha.user, `${URL}?coachId=${alpha.coach.id}`)).status).toBe(200);
    });

    it('member: only their own appointments; another member id is 403', async () => {
      const { a1, a2, a3 } = await seed();
      expect(ids(await get(memberA, `${URL}?limit=100`)).sort()).toEqual([a1.id, a3.id].sort());
      expect(ids(await get(memberB, `${URL}?limit=100`))).toEqual([a2.id]);
      expect((await get(memberA, `${URL}?memberId=${memberB.id}`)).status).toBe(403);
    });

    it('400 for a bad filter; 401 without a token', async () => {
      expect((await get(admin, `${URL}?state=booked`)).status).toBe(400);
      expect((await get(admin, `${URL}?from=2030-01-01`)).status).toBe(400);
      expect((await get(admin, `${URL}?bogus=1`)).status).toBe(400);
      expect((await request(app).get(URL)).status).toBe(401);
    });
  });

  describe('GET /appointments/:id', () => {
    it('manager any, coach own, member own; others 403; unknown 404; bad id 400', async () => {
      const created = await book();
      const url = `${URL}/${created.id}`;
      for (const caller of [admin, owner, alpha.user, memberA]) {
        const res = await get(caller, url);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(created.id);
      }
      expect((await get(bravo.user, url)).status).toBe(403);
      expect((await get(memberB, url)).status).toBe(403);
      expect((await get(admin, `${URL}/${MISSING_ID}`)).body.code).toBe('APPOINTMENT_NOT_FOUND');
      expect((await get(admin, `${URL}/nope`)).status).toBe(400);
    });
  });

  describe('methods', () => {
    it('answers 405 with an Allow header', async () => {
      const created = await book();
      expect((await request(app).delete(URL).set(as(admin))).headers.allow).toBe('GET, POST');
      expect(
        (await request(app).patch(`${URL}/${created.id}`).set(as(admin)).send({})).headers.allow,
      ).toBe('GET');
      expect((await get(admin, `${URL}/${created.id}/cancel`)).headers.allow).toBe('POST');
    });
  });
});
