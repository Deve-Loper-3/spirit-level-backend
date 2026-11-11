const crypto = require('crypto');
const request = require('supertest');

// No real emails: every SMTP send goes to this mock.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { openAllWeek } = require('../helpers/coachSchedule.helper');
const { createTestBooking } = require('../helpers/classBooking.helper');
const { createTestClass, deleteTestClasses } = require('../helpers/class.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const PREFIX = `test_cancelfx_${Date.now()}_`;
const SESSIONS_URL = '/api/v1/sessions';
const START = new Date('2030-03-05T06:00:00.000Z'); // 10:00 in Dubai

describe('class cancellation side effects: refunds, notifications, e-mails', () => {
  const testData = createTestData('cancelfx');
  let app;
  let admin;
  let memberA;
  let memberB;
  let alpha;
  let bravo;
  let cls;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    memberA = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Alpha' });
    memberB = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Bravo' });
    alpha = await testData.createCoach({ user: { fullName: 'Fx Alpha' } });
    bravo = await testData.createCoach({ user: { fullName: 'Fx Bravo' } });
    await openAllWeek(alpha.coach.id);
    await openAllWeek(bravo.coach.id);
    cls = await createTestClass(PREFIX, { durationMin: 60, baseCapacity: 12 });
  });

  const members = () => [memberA, memberB];
  const memberIds = () => members().map((m) => m.id);

  beforeEach(() => mockSendMail.mockReset().mockResolvedValue({}));

  afterEach(async () => {
    await prisma.memberCreditTransaction.deleteMany({ where: { memberId: { in: memberIds() } } });
    await prisma.classBooking.deleteMany({ where: { memberId: { in: memberIds() } } });
    await prisma.notification.deleteMany({ where: { userId: { in: memberIds() } } });
    await prisma.coachUnavailability.deleteMany({ where: { coachId: alpha.coach.id } });
    await prisma.classSession.deleteMany({ where: { classId: cls.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const post = (url, body = {}) => request(app).post(url).set(as(admin)).send(body);

  const insertSession = (extra = {}, coachList = []) =>
    prisma.classSession.create({
      data: {
        id: crypto.randomUUID(),
        classId: cls.id,
        startAt: START,
        endAt: new Date(START.getTime() + 60 * 60 * 1000),
        durationMin: 60,
        capacity: 12,
        state: 'OPEN',
        version: 1,
        coaches: { create: coachList.map((c) => ({ coachId: c.coach.id })) },
        ...extra,
      },
    });

  const cancel = (session) =>
    post(`${SESSIONS_URL}/${session.id}/cancel`, { reason: 'Facility maintenance' });
  const restore = (session) => post(`${SESSIONS_URL}/${session.id}/restore`);

  const ledgerOf = (ids = memberIds()) =>
    prisma.memberCreditTransaction.findMany({ where: { memberId: { in: ids } } });
  const notificationsOf = (ids = memberIds()) =>
    prisma.notification.findMany({ where: { userId: { in: ids } } });
  const bookingsOf = (session) =>
    prisma.classBooking.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

  // The e-mails are sent in the background: wait until the mock has been called `n` times.
  const waitForEmails = async (n) => {
    for (let i = 0; i < 50 && mockSendMail.mock.calls.length < n; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(mockSendMail).toHaveBeenCalledTimes(n);
    return mockSendMail.mock.calls.map((c) => c[0]);
  };

  it('two booked members: bookings CANCELLED, two +1 ledger rows, two notifications, two e-mails', async () => {
    const session = await insertSession();
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    await createTestBooking({ sessionId: session.id, memberId: memberB.id });

    const res = await cancel(session);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: session.id,
      state: 'cancelled',
      outcome: {
        booking: { cancelledCount: 2 },
        credit: { refundedCount: 2, creditsPerBooking: 1, totalCredits: 2 },
        waitlist: null,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('@test.invalid'); // recipients are not leaked

    const bookings = await bookingsOf(session);
    expect(bookings.map((b) => b.state)).toEqual(['CANCELLED', 'CANCELLED']);
    bookings.forEach((b) => expect(b.cancelledAt).toBeInstanceOf(Date));

    const ledger = await ledgerOf();
    expect(ledger).toHaveLength(2);
    ledger.forEach((row) => {
      expect(row).toMatchObject({ delta: 1, reason: 'CLASS_CANCELLED_REFUND' });
      expect(bookings.map((b) => b.id)).toContain(row.bookingId);
    });
    expect(ledger.map((r) => r.memberId).sort()).toEqual(memberIds().sort());

    const notifications = await notificationsOf();
    expect(notifications).toHaveLength(2);
    notifications.forEach((n) => {
      expect(n).toMatchObject({ type: 'CLASS_CANCELLED', title: 'Class cancelled', readAt: null });
      expect(n.body).toContain(cls.name);
      expect(n.data).toEqual({
        sessionId: session.id,
        classId: cls.id,
        startAt: START.toISOString(),
      });
    });
    expect(notifications.map((n) => n.userId).sort()).toEqual(memberIds().sort());

    const mails = await waitForEmails(2);
    expect(mails.map((m) => m.to).sort()).toEqual(
      members()
        .map((m) => m.email)
        .sort(),
    );
    expect(mails[0].subject).toContain(cls.name);
    expect(mails[0].text).toContain('1 credit has been returned');
  });

  it('only BOOKED bookings are touched: a booking that was already cancelled gets nothing', async () => {
    const session = await insertSession();
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    await createTestBooking({ sessionId: session.id, memberId: memberB.id, state: 'CANCELLED' });
    const res = await cancel(session);
    expect(res.body.data.outcome.booking).toEqual({ cancelledCount: 1 });
    expect((await ledgerOf()).map((r) => r.memberId)).toEqual([memberA.id]);
    expect((await notificationsOf()).map((n) => n.userId)).toEqual([memberA.id]);
    await waitForEmails(1);
  });

  it('cancel -> restore -> cancel never refunds twice; restore re-books nobody and reverses nothing', async () => {
    const session = await insertSession();
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    await createTestBooking({ sessionId: session.id, memberId: memberB.id });
    await cancel(session);
    await waitForEmails(2);

    const restored = await restore(session);
    expect(restored.status).toBe(200);
    expect((await bookingsOf(session)).map((b) => b.state)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(await ledgerOf()).toHaveLength(2);

    const again = await cancel(session);
    expect(again.status).toBe(200);
    expect(again.body.data.outcome).toEqual({ booking: null, credit: null, waitlist: null });
    expect(await ledgerOf()).toHaveLength(2);
    expect(await notificationsOf()).toHaveLength(2);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('the refund is idempotent per booking: a booking set back to BOOKED is cancelled again but not refunded again', async () => {
    const session = await insertSession();
    const booking = await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    await cancel(session);
    expect(await ledgerOf([memberA.id])).toHaveLength(1);

    await prisma.classBooking.update({
      where: { id: booking.id },
      data: { state: 'BOOKED', cancelledAt: null },
    });
    await restore(session);
    const second = await cancel(session);
    expect(second.status).toBe(200);
    expect(second.body.data.outcome.booking).toEqual({ cancelledCount: 1 });
    expect(second.body.data.outcome.credit.refundedCount).toBe(0); // skipped, not an error
    expect(await ledgerOf([memberA.id])).toHaveLength(1);
    expect((await prisma.classBooking.findUnique({ where: { id: booking.id } })).state).toBe(
      'CANCELLED',
    );
  });

  it('a cancel without bookings works as before: null outcome, no ledger, no notification, no mail', async () => {
    const session = await insertSession();
    const res = await cancel(session);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: session.id,
      state: 'cancelled',
      outcome: { booking: null, credit: null, waitlist: null },
    });
    expect(await ledgerOf()).toHaveLength(0);
    expect(await notificationsOf()).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('a failing e-mail does not fail the cancel and the notifications are still created', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const session = await insertSession();
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    const res = await cancel(session);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('cancelled');
    expect(await notificationsOf()).toHaveLength(1);
    expect(await ledgerOf()).toHaveLength(1);
    expect((await prisma.classSession.findUnique({ where: { id: session.id } })).state).toBe(
      'CANCELLED',
    );
  });

  it('a rejected cancel (empty reason) changes no booking and refunds nothing', async () => {
    const session = await insertSession();
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });
    const res = await post(`${SESSIONS_URL}/${session.id}/cancel`, { reason: '' });
    expect(res.status).toBe(400);
    expect((await bookingsOf(session))[0].state).toBe('BOOKED');
    expect(await ledgerOf()).toHaveLength(0);
    expect(await notificationsOf()).toHaveLength(0);
  });

  it('a coach replacement and a leave create NO notification and send NO e-mail, even with booked members', async () => {
    const session = await insertSession({}, [alpha]);
    await createTestBooking({ sessionId: session.id, memberId: memberA.id });

    const replaced = await request(app)
      .patch(`${SESSIONS_URL}/${session.id}`)
      .set(as(admin))
      .send({ coachIds: [bravo.coach.id], overrideReasons: { coachIds: 'Cover' } });
    expect(replaced.status).toBe(200);

    const leave = await request(app)
      .post(`/api/v1/coaches/${bravo.coach.id}/unavailability`)
      .set(as(admin))
      .send({ startDate: '2031-01-10', endDate: '2031-01-11', reason: 'Trip' });
    expect(leave.status).toBe(201);
    await prisma.coachUnavailability.deleteMany({ where: { coachId: bravo.coach.id } });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await notificationsOf()).toHaveLength(0);
    expect(await notificationsOf([alpha.user.id, bravo.user.id])).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect((await bookingsOf(session))[0].state).toBe('BOOKED'); // the booking is untouched too
    expect(await ledgerOf()).toHaveLength(0);
  });
});
