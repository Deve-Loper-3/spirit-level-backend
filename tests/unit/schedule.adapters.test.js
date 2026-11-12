jest.mock('../../src/config/prisma', () => ({ prismaDefault: true }));
jest.mock('../../src/repositories/classBooking.repository');
jest.mock('../../src/services/classCancellation.service', () => ({
  cancelBookingsAndRefund: jest.fn(),
}));

const prisma = require('../../src/config/prisma');
const { countBookedBySessions } = require('../../src/repositories/classBooking.repository');
const { cancelBookingsAndRefund } = require('../../src/services/classCancellation.service');
const {
  getBookingStats,
  getBookingStatsMap,
  getCancelOutcome,
} = require('../../src/services/schedule.adapters');

beforeEach(() => jest.resetAllMocks());

describe('schedule.adapters: the stubs are gone', () => {
  it('exports only the real seams', () => {
    expect(Object.keys(require('../../src/services/schedule.adapters')).sort()).toEqual([
      'getBookingStats',
      'getBookingStatsMap',
      'getCancelOutcome',
    ]);
  });
});

describe('getBookingStats', () => {
  it('returns the BOOKED count of the session and a documented waitlist of 0', async () => {
    countBookedBySessions.mockResolvedValue(new Map([['s1', 7]]));

    await expect(getBookingStats('s1')).resolves.toEqual({ bookedCount: 7, waitlistCount: 0 });
    expect(countBookedBySessions).toHaveBeenCalledWith(['s1'], prisma);
  });

  it('is 0 booked for a session with no bookings', async () => {
    countBookedBySessions.mockResolvedValue(new Map());
    await expect(getBookingStats('s1')).resolves.toEqual({ bookedCount: 0, waitlistCount: 0 });
  });

  it('uses the transaction client it is given', async () => {
    const tx = { tx: true };
    countBookedBySessions.mockResolvedValue(new Map());

    await getBookingStats('s1', tx);

    expect(countBookedBySessions).toHaveBeenCalledWith(['s1'], tx);
  });
});

describe('getBookingStatsMap', () => {
  it('asks for all the sessions in ONE call and has an entry for every id', async () => {
    countBookedBySessions.mockResolvedValue(new Map([['s2', 3]]));

    const stats = await getBookingStatsMap(['s1', 's2', 's3']);

    expect(countBookedBySessions).toHaveBeenCalledTimes(1);
    expect(countBookedBySessions).toHaveBeenCalledWith(['s1', 's2', 's3'], prisma);
    expect([...stats.keys()]).toEqual(['s1', 's2', 's3']);
    expect(stats.get('s1')).toEqual({ bookedCount: 0, waitlistCount: 0 });
    expect(stats.get('s2')).toEqual({ bookedCount: 3, waitlistCount: 0 });
  });

  it('returns an empty map for no sessions', async () => {
    countBookedBySessions.mockResolvedValue(new Map());
    expect((await getBookingStatsMap([])).size).toBe(0);
  });
});

describe('getCancelOutcome', () => {
  it('delegates to the cancellation service with the transaction client', async () => {
    const tx = { tx: true };
    cancelBookingsAndRefund.mockResolvedValue({ booking: null });

    await getCancelOutcome('s1', 'reason', tx);

    expect(cancelBookingsAndRefund).toHaveBeenCalledWith({ sessionId: 's1', client: tx });
  });
});
