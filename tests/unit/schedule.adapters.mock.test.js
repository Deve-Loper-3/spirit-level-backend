const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const scheduleRepository = require('../../src/repositories/schedule.repository');
const classRepository = require('../../src/repositories/class.repository');
const {
  getBookingStats,
  getCancelOutcome,
  isCoachQualified,
  isCoachOnLeave,
} = require('../../src/services/schedule.adapters');
const {
  patchSession,
  deleteSlot,
  reconcileSlotChange,
  createSlots,
  cancelSession,
} = require('../../src/services/schedule.service');

const mockTx = { tx: true };

// A date safely after "today" in any facility timezone, so the past-date check never trips.
const futureStartDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

jest.mock('../../src/config/prisma', () => ({
  $transaction: jest.fn((cb) => cb(mockTx)),
  classSession: {
    findMany: jest.fn(),
  },
}));
jest.mock('../../src/repositories/schedule.repository');
jest.mock('../../src/repositories/class.repository');
jest.mock('../../src/services/schedule.adapters');

describe('Schedule Service - Adapter Seams & Stubs Unit Tests', () => {
  const adminUser = { id: 'admin-user-1', role: Role.ADMIN };
  const coachUser = { id: 'coach-user-1', role: Role.COACH, coachId: 'coach-1' };
  const classId = 'class-123';
  const slotId = 'slot-123';
  const sessionId = 'session-123';

  const baseClassRecord = {
    id: classId,
    name: 'Power Yoga',
    status: 'ACTIVE',
    timezone: 'Asia/Dubai',
    baseCapacity: 20,
    coaches: [{ coachId: 'coach-1', coach: { id: 'coach-1', userId: 'coach-user-1' } }],
  };

  const baseSessionRecord = {
    id: sessionId,
    classId,
    slotId,
    startAt: new Date(Date.now() + 86400000), // tomorrow
    endAt: new Date(Date.now() + 86400000 + 3600000),
    capacity: 20,
    state: 'OPEN',
    version: 1,
    overriddenFields: [],
    overrideDetails: {},
    class: baseClassRecord,
    coaches: [{ coachId: 'coach-1', coach: { id: 'coach-1', userId: 'coach-user-1' } }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scheduleRepository.acquireClassAdvisoryLock.mockResolvedValue(true);
    scheduleRepository.findCoachesByIdsWithDetails.mockResolvedValue([
      { id: 'coach-1', status: 'ACTIVE', user: { status: 'ACTIVE' } },
    ]);
    scheduleRepository.findCoachOverlappingSessions.mockResolvedValue([]);
    scheduleRepository.findActiveSlotConflict.mockResolvedValue(null);
    scheduleRepository.findSessionAtStartTime.mockResolvedValue(null);
    classRepository.findById.mockResolvedValue(baseClassRecord);
  });

  describe('1. getBookingStats bookedCount vs Capacity Check', () => {
    it('rejects PATCH capacity with 400 CAPACITY_BELOW_BOOKED when new capacity < bookedCount', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      getBookingStats.mockResolvedValue({ bookedCount: 15, waitlistCount: 3 });

      await expect(
        patchSession({
          sessionId,
          payload: {
            capacity: 10, // below bookedCount of 15
            overrideReasons: { capacity: 'Downsizing room' },
          },
          user: adminUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: AppErrors.CAPACITY_BELOW_BOOKED.code,
      });

      expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    });

    it('allows PATCH capacity when new capacity >= bookedCount', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      scheduleRepository.updateSession.mockResolvedValue({
        ...baseSessionRecord,
        capacity: 18,
        version: 2,
      });
      getBookingStats.mockResolvedValue({ bookedCount: 15, waitlistCount: 3 });

      const result = await patchSession({
        sessionId,
        payload: {
          capacity: 18, // >= bookedCount of 15
          overrideReasons: { capacity: 'Slightly reduced' },
        },
        user: adminUser,
      });

      expect(result.capacity).toBe(18);
      expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. bookedCount > 0 preserves sessions during reconciliation and slot deletion', () => {
    it('skips updating session during slot reconciliation when bookedCount > 0', async () => {
      scheduleRepository.findSlotById.mockResolvedValue({
        id: slotId,
        classId,
        dayOfWeek: 1,
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
        capacity: 25,
        coaches: [{ coachId: 'coach-1' }],
        class: baseClassRecord,
      });

      const bookedSession = {
        id: 'session-booked',
        slotId,
        startAt: new Date(Date.now() + 86400000),
        endAt: new Date(Date.now() + 86400000 + 3600000),
        overriddenFields: [],
      };

      scheduleRepository.findGeneratedFutureSessionsForSlot.mockResolvedValue([bookedSession]);
      getBookingStats.mockResolvedValue({ bookedCount: 4, waitlistCount: 1 });
      scheduleRepository.findSlotsByClassId.mockResolvedValue([]);

      await reconcileSlotChange({ slotId, client: mockTx });

      // Session must NOT be modified because it has active bookings
      expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    });

    it('preserves booked sessions during slot DELETE and only removes unbooked ones', async () => {
      scheduleRepository.findSlotById.mockResolvedValue({
        id: slotId,
        classId,
      });
      scheduleRepository.softDeactivateSlot.mockResolvedValue(true);

      const bookedSession = { id: 'session-booked', overriddenFields: [] };
      const unbookedSession = { id: 'session-unbooked', overriddenFields: [] };
      const overriddenSession = { id: 'session-overridden', overriddenFields: ['capacity'] };

      scheduleRepository.findGeneratedFutureSessionsForSlot.mockResolvedValue([
        bookedSession,
        unbookedSession,
        overriddenSession,
      ]);

      getBookingStats.mockImplementation(async (id) => {
        if (id === 'session-booked') return { bookedCount: 3, waitlistCount: 0 };
        return { bookedCount: 0, waitlistCount: 0 };
      });

      const result = await deleteSlot({ slotId, classId, user: adminUser });

      expect(scheduleRepository.softDeactivateSlot).toHaveBeenCalledWith(slotId, mockTx);
      // Only unbooked and non-overridden session is removed
      expect(scheduleRepository.deleteSessionsByIds).toHaveBeenCalledWith(
        ['session-unbooked'],
        mockTx,
      );
      expect(result.removedSessionsCount).toBe(1);
    });
  });

  describe('3. isCoachOnLeave true -> 409 COACH_CONFLICT', () => {
    it('rejects slot POST with 409 COACH_CONFLICT when coach is on approved leave', async () => {
      isCoachQualified.mockResolvedValue(true);
      isCoachOnLeave.mockResolvedValue(true);

      await expect(
        createSlots({
          classId,
          payload: {
            startDate: futureStartDate,
            days: [
              {
                dayOfWeek: 1,
                times: [
                  {
                    startTime: '10:00',
                    endTime: '11:00',
                    coachIds: ['coach-1'],
                    capacity: 20,
                  },
                ],
              },
            ],
          },
          user: adminUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_CONFLICT.code,
        details: {
          conflicts: [
            expect.objectContaining({
              type: 'COACH_LEAVE',
              coachId: 'coach-1',
            }),
          ],
        },
      });

      expect(scheduleRepository.createSlotWithCoaches).not.toHaveBeenCalled();
    });

    it('rejects session PATCH with 409 COACH_CONFLICT when updated coach is on leave', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      isCoachQualified.mockResolvedValue(true);
      isCoachOnLeave.mockResolvedValue(true);
      getBookingStats.mockResolvedValue({ bookedCount: 0, waitlistCount: 0 });

      await expect(
        patchSession({
          sessionId,
          payload: {
            coachIds: ['coach-1'],
            overrideReasons: { coachIds: 'Assigning covering coach' },
          },
          user: adminUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_CONFLICT.code,
        details: {
          conflicts: [
            expect.objectContaining({
              type: 'COACH_LEAVE',
              coachId: 'coach-1',
            }),
          ],
        },
      });

      expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    });
  });

  describe('4. isCoachQualified false -> 409 COACH_CONFLICT', () => {
    it('rejects slot POST with 409 COACH_CONFLICT when coach is unqualified', async () => {
      isCoachQualified.mockResolvedValue(false);
      isCoachOnLeave.mockResolvedValue(false);

      await expect(
        createSlots({
          classId,
          payload: {
            startDate: futureStartDate,
            days: [
              {
                dayOfWeek: 1,
                times: [
                  {
                    startTime: '10:00',
                    endTime: '11:00',
                    coachIds: ['coach-1'],
                    capacity: 20,
                  },
                ],
              },
            ],
          },
          user: adminUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_CONFLICT.code,
        details: {
          conflicts: [
            expect.objectContaining({
              type: 'COACH_UNQUALIFIED',
              coachId: 'coach-1',
              classId,
            }),
          ],
        },
      });

      expect(scheduleRepository.createSlotWithCoaches).not.toHaveBeenCalled();
    });

    it('rejects session PATCH with 409 COACH_CONFLICT when assigned coach is unqualified', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      isCoachQualified.mockResolvedValue(false);
      isCoachOnLeave.mockResolvedValue(false);
      getBookingStats.mockResolvedValue({ bookedCount: 0, waitlistCount: 0 });

      await expect(
        patchSession({
          sessionId,
          payload: {
            coachIds: ['coach-1'],
            overrideReasons: { coachIds: 'Assigning new coach' },
          },
          user: adminUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_CONFLICT.code,
        details: {
          conflicts: [
            expect.objectContaining({
              type: 'COACH_UNQUALIFIED',
              coachId: 'coach-1',
              classId,
            }),
          ],
        },
      });

      expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    });
  });

  describe('5. Coach cancel on a session with bookedCount > 0 is rejected', () => {
    it('rejects coach cancel on session with active bookings with 403 FORBIDDEN', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      getBookingStats.mockResolvedValue({ bookedCount: 2, waitlistCount: 1 });

      await expect(
        cancelSession({
          sessionId,
          payload: { reason: 'Emergency personal absence' },
          user: coachUser,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: AppErrors.FORBIDDEN.code,
      });

      expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
      expect(getCancelOutcome).not.toHaveBeenCalled();
    });

    it('allows coach cancel on own session when bookedCount is 0', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      getBookingStats.mockResolvedValue({ bookedCount: 0, waitlistCount: 0 });
      getCancelOutcome.mockResolvedValue({ booking: null, credit: null, waitlist: null });
      scheduleRepository.updateSession.mockResolvedValue(true);

      const result = await cancelSession({
        sessionId,
        payload: { reason: 'Empty session cancellation' },
        user: coachUser,
      });

      expect(result).toMatchObject({
        id: sessionId,
        state: 'cancelled',
      });
      expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
    });

    it('allows admin cancel even when session has active bookings (review flow)', async () => {
      scheduleRepository.findSessionById.mockResolvedValue(baseSessionRecord);
      getBookingStats.mockResolvedValue({ bookedCount: 8, waitlistCount: 2 });
      getCancelOutcome.mockResolvedValue({
        booking: { cancelledCount: 8 },
        credit: true,
        waitlist: true,
      });
      scheduleRepository.updateSession.mockResolvedValue(true);

      const result = await cancelSession({
        sessionId,
        payload: { reason: 'Facility maintenance' },
        user: adminUser,
      });

      expect(result).toMatchObject({
        id: sessionId,
        state: 'cancelled',
        outcome: { booking: { cancelledCount: 8 }, credit: true, waitlist: true },
      });
      expect(getCancelOutcome).toHaveBeenCalledWith(sessionId, 'Facility maintenance');
    });
  });
});
