jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../../src/repositories/classBooking.repository', () => ({
  findBookedBySession: jest.fn(),
  cancelBookings: jest.fn(),
}));
jest.mock('../../src/repositories/creditLedger.repository', () => ({
  insertClassCancelledRefunds: jest.fn(),
}));
jest.mock('../../src/repositories/notification.repository', () => ({
  createNotifications: jest.fn(),
}));
jest.mock('../../src/infra/mail/notify.service', () => ({ sendClassCancelled: jest.fn() }));

const logger = require('../../src/config/logger');
const bookingRepo = require('../../src/repositories/classBooking.repository');
const ledgerRepo = require('../../src/repositories/creditLedger.repository');
const notificationRepo = require('../../src/repositories/notification.repository');
const { sendClassCancelled } = require('../../src/infra/mail/notify.service');
const {
  cancelBookingsAndRefund,
  notifyMembersOfCancellation,
  formatWhen,
} = require('../../src/services/classCancellation.service');

const tx = { tx: true };
const NOW = new Date('2026-11-11T08:00:00.000Z');
const booking = (n) => ({
  id: `b${n}`,
  memberId: `m${n}`,
  member: { fullName: `Member ${n}`, email: `m${n}@test.invalid` },
});

beforeEach(() => {
  jest.resetAllMocks();
  bookingRepo.findBookedBySession.mockResolvedValue([booking(1), booking(2)]);
  bookingRepo.cancelBookings.mockResolvedValue(2);
  ledgerRepo.insertClassCancelledRefunds.mockResolvedValue(2);
  notificationRepo.createNotifications.mockResolvedValue(2);
  sendClassCancelled.mockResolvedValue({});
});

describe('cancelBookingsAndRefund (inside the cancel transaction)', () => {
  it('cancels the BOOKED bookings with one cancelledAt and refunds one credit per booking, all through the transaction client', async () => {
    const out = await cancelBookingsAndRefund({ sessionId: 's1', now: NOW, client: tx });
    expect(bookingRepo.findBookedBySession).toHaveBeenCalledWith('s1', tx);
    expect(bookingRepo.cancelBookings).toHaveBeenCalledWith(['b1', 'b2'], NOW, tx);
    expect(ledgerRepo.insertClassCancelledRefunds).toHaveBeenCalledWith(
      [booking(1), booking(2)],
      tx,
    );
    expect(out.booking).toEqual({ cancelledCount: 2 });
    expect(out.credit).toEqual({ refundedCount: 2, creditsPerBooking: 1, totalCredits: 2 });
    expect(out.waitlist).toBeNull();
  });

  it('returns the recipients (internal) with name and e-mail', async () => {
    const out = await cancelBookingsAndRefund({ sessionId: 's1', client: tx });
    expect(out.recipients).toEqual([
      { bookingId: 'b1', memberId: 'm1', fullName: 'Member 1', email: 'm1@test.invalid' },
      { bookingId: 'b2', memberId: 'm2', fullName: 'Member 2', email: 'm2@test.invalid' },
    ]);
  });

  it('is idempotent: bookings already refunded insert no new ledger row (refundedCount 0, no error)', async () => {
    ledgerRepo.insertClassCancelledRefunds.mockResolvedValue(0);
    const out = await cancelBookingsAndRefund({ sessionId: 's1', client: tx });
    expect(out.credit).toEqual({ refundedCount: 0, creditsPerBooking: 1, totalCredits: 0 });
    expect(out.booking).toEqual({ cancelledCount: 2 });
  });

  it('only some refunds inserted: the credit summary counts what was really inserted', async () => {
    ledgerRepo.insertClassCancelledRefunds.mockResolvedValue(1);
    const out = await cancelBookingsAndRefund({ sessionId: 's1', client: tx });
    expect(out.credit.totalCredits).toBe(1);
  });

  it('no bookings: the same all-null outcome as before, nothing written, no recipients', async () => {
    bookingRepo.findBookedBySession.mockResolvedValue([]);
    const out = await cancelBookingsAndRefund({ sessionId: 's1', client: tx });
    expect(out).toEqual({ booking: null, credit: null, waitlist: null, recipients: [] });
    expect(bookingRepo.cancelBookings).not.toHaveBeenCalled();
    expect(ledgerRepo.insertClassCancelledRefunds).not.toHaveBeenCalled();
  });
});

describe('notifyMembersOfCancellation (after the commit)', () => {
  const session = {
    id: 's1',
    classId: 'class-1',
    startAt: new Date('2026-12-01T06:00:00.000Z'),
    class: { name: 'Power Yoga' },
  };
  const recipients = [
    { bookingId: 'b1', memberId: 'm1', fullName: 'Member 1', email: 'm1@test.invalid' },
    { bookingId: 'b2', memberId: 'm2', fullName: 'Member 2', email: 'm2@test.invalid' },
  ];

  it('creates ALL notifications in one batch, with the agreed type and data', async () => {
    await notifyMembersOfCancellation({ session, recipients });
    expect(notificationRepo.createNotifications).toHaveBeenCalledTimes(1);
    const items = notificationRepo.createNotifications.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      userId: 'm1',
      type: 'CLASS_CANCELLED',
      title: 'Class cancelled',
      body: expect.stringContaining('Power Yoga'),
      data: { sessionId: 's1', classId: 'class-1', startAt: '2026-12-01T06:00:00.000Z' },
    });
    expect(items[0].body).toContain('Tue, 1 Dec 2026');
    expect(items[0].body).toContain('10:00'); // facility time (UTC+4)
    expect(items[0].body).toContain('1 credit has been returned');
    expect(items.map((i) => i.userId)).toEqual(['m1', 'm2']);
  });

  it('sends one e-mail per recipient with the class name and time', async () => {
    const { emails } = await notifyMembersOfCancellation({ session, recipients });
    await emails;
    expect(sendClassCancelled).toHaveBeenCalledTimes(2);
    expect(sendClassCancelled).toHaveBeenCalledWith(
      { email: 'm1@test.invalid', fullName: 'Member 1' },
      { className: 'Power Yoga', when: formatWhen(session.startAt), credits: 1 },
    );
  });

  it('a failing notification insert is logged and does not throw; the e-mails still go out', async () => {
    notificationRepo.createNotifications.mockRejectedValue(new Error('db down'));
    const result = await notifyMembersOfCancellation({ session, recipients });
    expect(result.notificationsCreated).toBe(0);
    await result.emails;
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(sendClassCancelled).toHaveBeenCalledTimes(2);
  });

  it('a failing e-mail is logged, never thrown, and does not stop the others', async () => {
    sendClassCancelled.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValue({});
    const { emails } = await notifyMembersOfCancellation({ session, recipients });
    await expect(emails).resolves.toBeDefined();
    expect(sendClassCancelled).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('no recipients: nothing is created or sent', async () => {
    const out = await notifyMembersOfCancellation({ session, recipients: [] });
    expect(out.notificationsCreated).toBe(0);
    expect(notificationRepo.createNotifications).not.toHaveBeenCalled();
    expect(sendClassCancelled).not.toHaveBeenCalled();
  });
});
