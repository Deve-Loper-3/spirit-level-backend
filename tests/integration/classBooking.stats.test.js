const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { countBookedBySessions } = require('../../src/repositories/classBooking.repository');
const { getBookingStats, getBookingStatsMap } = require('../../src/services/schedule.adapters');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestBooking } = require('../helpers/classBooking.helper');
const { createTestClass, deleteTestClasses } = require('../helpers/class.helper');

jest.setTimeout(120000);

const PREFIX = `test_bkstats_${Date.now()}_`;
const SESSIONS_URL = '/api/v1/sessions';
const START = new Date('2030-04-02T06:00:00.000Z');

describe('booking stats are real (bookedCount from class_bookings)', () => {
  const testData = createTestData('bkstats');
  let app;
  let admin;
  let members;
  let cls;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    members = [
      await testData.createUser({ role: Role.MEMBER }),
      await testData.createUser({ role: Role.MEMBER }),
      await testData.createUser({ role: Role.MEMBER }),
    ];
    cls = await createTestClass(PREFIX, { durationMin: 60, baseCapacity: 12 });
  });

  afterEach(async () => {
    await prisma.classBooking.deleteMany({ where: { memberId: { in: members.map((m) => m.id) } } });
    await prisma.classSession.deleteMany({ where: { classId: cls.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const insertSession = (startOffsetHours = 0, extra = {}) => {
    const startAt = new Date(START.getTime() + startOffsetHours * 60 * 60 * 1000);
    return prisma.classSession.create({
      data: {
        id: crypto.randomUUID(),
        classId: cls.id,
        startAt,
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        durationMin: 60,
        capacity: 12,
        state: 'OPEN',
        version: 1,
        ...extra,
      },
    });
  };

  const as = (caller) => ({ Authorization: bearerFor(caller) });

  it('counts only BOOKED bookings, per session, in one grouped query', async () => {
    const one = await insertSession(0);
    const two = await insertSession(3);
    const empty = await insertSession(6);
    await createTestBooking({ sessionId: one.id, memberId: members[0].id });
    await createTestBooking({ sessionId: one.id, memberId: members[1].id });
    await createTestBooking({ sessionId: one.id, memberId: members[2].id, state: 'CANCELLED' });
    await createTestBooking({ sessionId: two.id, memberId: members[0].id });

    const counts = await countBookedBySessions([one.id, two.id, empty.id]);

    expect(counts.get(one.id)).toBe(2);
    expect(counts.get(two.id)).toBe(1);
    expect(counts.has(empty.id)).toBe(false);

    const stats = await getBookingStatsMap([one.id, two.id, empty.id]);
    expect(stats.get(empty.id)).toEqual({ bookedCount: 0, waitlistCount: 0 });
    expect(stats.get(one.id)).toEqual({ bookedCount: 2, waitlistCount: 0 });
    expect(await getBookingStats(two.id)).toEqual({ bookedCount: 1, waitlistCount: 0 });
  });

  it('countBookedBySessions of no sessions runs no query and returns an empty map', async () => {
    expect((await countBookedBySessions([])).size).toBe(0);
  });

  it('GET /sessions/:id shows the real bookedCount and waitlistCount 0', async () => {
    const session = await insertSession(0);
    await createTestBooking({ sessionId: session.id, memberId: members[0].id });
    await createTestBooking({ sessionId: session.id, memberId: members[1].id });

    const res = await request(app).get(`${SESSIONS_URL}/${session.id}`).set(as(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.bookedCount).toBe(2);
    expect(res.body.data.waitlistCount).toBe(0);
  });

  it('PATCH capacity below the booked count is now refused with 400 CAPACITY_BELOW_BOOKED', async () => {
    const session = await insertSession(0);
    await createTestBooking({ sessionId: session.id, memberId: members[0].id });
    await createTestBooking({ sessionId: session.id, memberId: members[1].id });

    const tooLow = await request(app)
      .patch(`${SESSIONS_URL}/${session.id}`)
      .set(as(admin))
      .send({ capacity: 1, overrideReasons: { capacity: 'Smaller room' } });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.code).toBe('CAPACITY_BELOW_BOOKED');

    const enough = await request(app)
      .patch(`${SESSIONS_URL}/${session.id}`)
      .set(as(admin))
      .send({ capacity: 2, overrideReasons: { capacity: 'Smaller room' } });
    expect(enough.status).toBe(200);
    expect(enough.body.data.capacity).toBe(2);
  });

  it('a cancelled booking does not count, so the capacity can go down again', async () => {
    const session = await insertSession(0);
    await createTestBooking({ sessionId: session.id, memberId: members[0].id, state: 'CANCELLED' });

    const res = await request(app)
      .patch(`${SESSIONS_URL}/${session.id}`)
      .set(as(admin))
      .send({ capacity: 1, overrideReasons: { capacity: 'Smaller room' } });

    expect(res.status).toBe(200);
  });
});
