const mockTx = { tx: true };

jest.mock('../../src/config/prisma', () => ({
  $transaction: jest.fn(),
  classSession: { findMany: jest.fn() },
}));
jest.mock('../../src/repositories/schedule.repository');
jest.mock('../../src/repositories/class.repository');
jest.mock('../../src/services/schedule.adapters');
jest.mock('../../src/services/classCancellation.service', () => ({
  notifyMembersOfCancellation: jest.fn(),
}));

const prisma = require('../../src/config/prisma');
const scheduleRepository = require('../../src/repositories/schedule.repository');
const { getBookingStats, getCancelOutcome } = require('../../src/services/schedule.adapters');
const { notifyMembersOfCancellation } = require('../../src/services/classCancellation.service');
const { cancelSession, restoreSession } = require('../../src/services/schedule.service');
const { Role } = require('../../src/constants/roles');

const DAY = 24 * 60 * 60 * 1000;
const admin = { id: 'admin-1', role: Role.ADMIN };
const session = {
  id: 'session-1',
  classId: 'class-1',
  slotId: null,
  startAt: new Date(Date.now() + 3 * DAY),
  endAt: new Date(Date.now() + 3 * DAY + 3600000),
  capacity: 10,
  state: 'OPEN',
  overriddenFields: [],
  overrideDetails: {},
  class: { id: 'class-1', name: 'Yoga' },
  coaches: [],
};
const recipients = [
  { bookingId: 'b1', memberId: 'm1', fullName: 'Member 1', email: 'm1@test.invalid' },
];

let order;
beforeEach(() => {
  jest.resetAllMocks();
  order = [];
  prisma.$transaction.mockImplementation(async (cb) => {
    const result = await cb(mockTx);
    order.push('commit');
    return result;
  });
  scheduleRepository.acquireClassAdvisoryLock.mockResolvedValue(true);
  scheduleRepository.findSessionById.mockResolvedValue(session);
  scheduleRepository.updateSession.mockImplementation(async () => {
    order.push('updateSession');
    return true;
  });
  getBookingStats.mockResolvedValue({ bookedCount: 0, waitlistCount: 0 });
  getCancelOutcome.mockImplementation(async () => {
    order.push('getCancelOutcome');
    return {
      booking: { cancelledCount: 1 },
      credit: { refundedCount: 1, creditsPerBooking: 1, totalCredits: 1 },
      waitlist: null,
      recipients,
    };
  });
  notifyMembersOfCancellation.mockImplementation(async () => {
    order.push('notify');
    return { notificationsCreated: 1, emails: Promise.resolve([]) };
  });
});

describe('cancelSession side effects', () => {
  const cancel = () =>
    cancelSession({ sessionId: 'session-1', payload: { reason: 'Maintenance' }, user: admin });

  it('cancels the bookings through the transaction client, inside the transaction', async () => {
    await cancel();
    expect(getCancelOutcome).toHaveBeenCalledWith('session-1', 'Maintenance', mockTx);
    expect(order.indexOf('getCancelOutcome')).toBeLessThan(order.indexOf('commit'));
    expect(order.indexOf('updateSession')).toBeLessThan(order.indexOf('commit'));
  });

  it('notifies AFTER the commit, with the session and the recipients', async () => {
    await cancel();
    expect(order).toEqual(['getCancelOutcome', 'updateSession', 'commit', 'notify']);
    expect(notifyMembersOfCancellation).toHaveBeenCalledWith({ session, recipients });
  });

  it('keeps the response shape: outcome without the internal recipients', async () => {
    const result = await cancel();
    expect(result).toEqual({
      id: 'session-1',
      state: 'cancelled',
      outcome: {
        booking: { cancelledCount: 1 },
        credit: { refundedCount: 1, creditsPerBooking: 1, totalCredits: 1 },
        waitlist: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain('m1@test.invalid');
  });

  it('a notification / e-mail failure does not fail the cancel', async () => {
    notifyMembersOfCancellation.mockRejectedValue(new Error('boom'));
    await expect(cancel()).resolves.toMatchObject({ id: 'session-1', state: 'cancelled' });
  });

  it('nothing is notified when the transaction fails (no side effects of a rolled-back cancel)', async () => {
    scheduleRepository.updateSession.mockRejectedValue(new Error('db error'));
    await expect(cancel()).rejects.toThrow('db error');
    expect(notifyMembersOfCancellation).not.toHaveBeenCalled();
  });

  it('a rejected cancel (empty reason) cancels no booking and notifies nobody', async () => {
    await expect(
      cancelSession({ sessionId: 'session-1', payload: { reason: ' ' }, user: admin }),
    ).rejects.toMatchObject({ code: 'CANCEL_REASON_REQUIRED' });
    expect(getCancelOutcome).not.toHaveBeenCalled();
    expect(notifyMembersOfCancellation).not.toHaveBeenCalled();
  });

  it('a cancel without bookings behaves as before (null outcome parts, empty recipients)', async () => {
    getCancelOutcome.mockResolvedValue({
      booking: null,
      credit: null,
      waitlist: null,
      recipients: [],
    });
    const result = await cancel();
    expect(result.outcome).toEqual({ booking: null, credit: null, waitlist: null });
  });
});

describe('restoreSession', () => {
  it('re-books nobody, reverses no credit and notifies nobody', async () => {
    scheduleRepository.findSessionById.mockResolvedValue({ ...session, state: 'CANCELLED' });
    scheduleRepository.findSessionAtStartTime.mockResolvedValue(null);
    scheduleRepository.updateSession.mockResolvedValue({ ...session, state: 'OPEN' });
    await restoreSession({ sessionId: 'session-1', user: admin });
    expect(getCancelOutcome).not.toHaveBeenCalled();
    expect(notifyMembersOfCancellation).not.toHaveBeenCalled();
  });
});
