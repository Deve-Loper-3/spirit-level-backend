jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({ $transaction: jest.fn() }));
jest.mock('../../src/repositories/coach.repository', () => ({ findCoachById: jest.fn() }));
jest.mock('../../src/repositories/coachAvailability.repository', () => ({
  findWeekByCoachId: jest.fn(),
  lockCoachAvailability: jest.fn(),
  replaceWeek: jest.fn(),
}));
jest.mock('../../src/repositories/audit-log.repository', () => ({ createAuditLog: jest.fn() }));

const prisma = require('../../src/config/prisma');
const { findCoachById } = require('../../src/repositories/coach.repository');
const {
  findWeekByCoachId,
  lockCoachAvailability,
  replaceWeek,
} = require('../../src/repositories/coachAvailability.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const {
  getWeeklyAvailability,
  saveWeeklyAvailability,
  assertNoOverlappingSlots,
} = require('../../src/services/coachAvailability.service');
const { Messages } = require('../../src/constants/messages');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

const COACH_ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const COACH_USER_ID = 'user-of-coach';
const coachRow = { id: COACH_ID, user: { id: COACH_USER_ID, email: 'coach@test.invalid' } };

const admin = { id: 'admin-id', role: Role.ADMIN };
const ownCoach = { id: COACH_USER_ID, role: Role.COACH };
const otherCoach = { id: 'someone-else', role: Role.COACH };
const member = { id: 'member-id', role: Role.MEMBER };

const day = (
  dayOfWeek,
  slots = [{ startTime: '09:00', endTime: '17:00' }],
  isAvailable = true,
) => ({
  dayOfWeek,
  isAvailable,
  slots,
});
const week = (...overrides) =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => overrides.find((o) => o.dayOfWeek === d) ?? day(d));

const savedRow = (
  dayOfWeek,
  startTime,
  endTime,
  updatedAt = new Date('2026-11-11T08:00:00.000Z'),
) => ({
  dayOfWeek,
  isAvailable: true,
  updatedAt,
  slots: [
    {
      startTime: new Date(`1970-01-01T${startTime}:00.000Z`),
      endTime: new Date(`1970-01-01T${endTime}:00.000Z`),
    },
  ],
});

const thrownBy = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
};

describe('coachAvailability.service', () => {
  const tx = { name: 'tx' };

  beforeEach(() => {
    jest.resetAllMocks();
    findCoachById.mockResolvedValue(coachRow);
    findWeekByCoachId.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  });

  describe('assertNoOverlappingSlots', () => {
    it('accepts disjoint and touching slots', () => {
      expect(() =>
        assertNoOverlappingSlots([
          day(1, [
            { startTime: '06:00', endTime: '09:00' },
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '15:00', endTime: '18:00' },
          ]),
          day(2, [], false),
        ]),
      ).not.toThrow();
    });

    it('rejects an overlap with 400 and a message naming the day and both slots', async () => {
      const err = await thrownBy(async () =>
        assertNoOverlappingSlots([
          day(1),
          day(2),
          day(3, [
            { startTime: '09:00', endTime: '12:00' },
            { startTime: '11:00', endTime: '14:00' },
          ]),
        ]),
      );
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toBe(
        Messages.AVAILABILITY_SLOTS_OVERLAP_DETAIL('Wednesday', '09:00-12:00', '11:00-14:00'),
      );
      expect(err.message).toContain('Wednesday');
      expect(err.message).toContain('09:00-12:00');
      expect(err.message).toContain('11:00-14:00');
      expect(err.details).toEqual([{ field: 'days.2.slots.1.startTime', message: err.message }]);
    });

    it('names the earlier-starting slot first even when the input is out of order', async () => {
      const err = await thrownBy(async () =>
        assertNoOverlappingSlots([
          day(5, [
            { startTime: '14:00', endTime: '18:00' },
            { startTime: '08:00', endTime: '15:00' },
          ]),
        ]),
      );
      expect(err.message).toContain('Friday: 08:00-15:00 overlaps 14:00-18:00');
      expect(err.details[0].field).toBe('days.0.slots.1.startTime');
    });

    it('rejects a slot whose end is not after its start', async () => {
      const err = await thrownBy(async () =>
        assertNoOverlappingSlots([day(1, [{ startTime: '10:00', endTime: '10:00' }])]),
      );
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual([
        { field: 'days.0.slots.0.endTime', message: Messages.SLOT_END_BEFORE_START },
      ]);
    });
  });

  describe('getWeeklyAvailability', () => {
    it('returns 7 unavailable days for a coach with no saved hours', async () => {
      const view = await getWeeklyAvailability({ caller: admin, coachId: COACH_ID });
      expect(view).toMatchObject({
        coachId: COACH_ID,
        timezone: 'Asia/Dubai',
        isConfigured: false,
        updatedAt: null,
      });
      expect(view.days.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(view.days.every((d) => d.isAvailable === false && d.slots.length === 0)).toBe(true);
    });

    it('returns the saved days with HH:mm times and the other days unavailable', async () => {
      findWeekByCoachId.mockResolvedValue([savedRow(2, '06:30', '12:00')]);
      const view = await getWeeklyAvailability({ caller: admin, coachId: COACH_ID });
      expect(view.isConfigured).toBe(true);
      expect(view.updatedAt).toBe('2026-11-11T08:00:00.000Z');
      expect(view.days[1]).toEqual({
        dayOfWeek: 2,
        isAvailable: true,
        slots: [{ startTime: '06:30', endTime: '12:00' }],
      });
      expect(view.days[0]).toEqual({ dayOfWeek: 1, isAvailable: false, slots: [] });
    });

    it('lets a coach read their own week', async () => {
      await expect(
        getWeeklyAvailability({ caller: ownCoach, coachId: COACH_ID }),
      ).resolves.toBeDefined();
    });

    it('answers 403 to another coach and to a member', async () => {
      for (const caller of [otherCoach, member]) {
        const err = await thrownBy(() => getWeeklyAvailability({ caller, coachId: COACH_ID }));
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('FORBIDDEN');
      }
      expect(findWeekByCoachId).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown coach', async () => {
      findCoachById.mockResolvedValue(null);
      const err = await thrownBy(() => getWeeklyAvailability({ caller: admin, coachId: COACH_ID }));
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('COACH_NOT_FOUND');
    });
  });

  describe('saveWeeklyAvailability', () => {
    const meta = { ipAddress: '1.2.3.4', userAgent: 'jest' };

    it.each([
      ['a coach', ownCoach],
      ['a member', member],
    ])('answers 403 to %s before anything is read or written', async (_name, actor) => {
      const err = await thrownBy(() =>
        saveWeeklyAvailability({ actor, coachId: COACH_ID, days: week(), meta }),
      );
      expect(err.statusCode).toBe(403);
      expect(findCoachById).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown coach and writes nothing', async () => {
      findCoachById.mockResolvedValue(null);
      const err = await thrownBy(() =>
        saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days: week(), meta }),
      );
      expect(err.statusCode).toBe(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects overlapping slots with 400 before opening a transaction', async () => {
      const days = week(
        day(1, [
          { startTime: '09:00', endTime: '12:00' },
          { startTime: '11:00', endTime: '14:00' },
        ]),
      );
      const err = await thrownBy(() =>
        saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days, meta }),
      );
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('Monday');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(replaceWeek).not.toHaveBeenCalled();
    });

    it('accepts touching slots', async () => {
      const days = week(
        day(1, [
          { startTime: '09:00', endTime: '12:00' },
          { startTime: '12:00', endTime: '15:00' },
        ]),
      );
      await expect(
        saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days, meta }),
      ).resolves.toBeDefined();
      expect(replaceWeek).toHaveBeenCalledWith(COACH_ID, days, tx);
    });

    it('locks, reads the old week, replaces, audits and reads back, all on the transaction client', async () => {
      const order = [];
      lockCoachAvailability.mockImplementation(async () => order.push('lock'));
      findWeekByCoachId.mockImplementation(async () => {
        order.push('read');
        return order.filter((x) => x === 'read').length === 1
          ? [savedRow(1, '09:00', '10:00')]
          : [savedRow(1, '06:00', '12:00')];
      });
      replaceWeek.mockImplementation(async () => order.push('replace'));
      createAuditLog.mockImplementation(async () => order.push('audit'));

      const days = week(
        day(1, [{ startTime: '06:00', endTime: '12:00' }]),
        day(6, [], false),
        day(7, [], false),
      );
      const view = await saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days, meta });

      expect(order).toEqual(['lock', 'read', 'replace', 'audit', 'read']);
      expect(lockCoachAvailability).toHaveBeenCalledWith(COACH_ID, tx);
      expect(findWeekByCoachId).toHaveBeenNthCalledWith(1, COACH_ID, tx);
      expect(findWeekByCoachId).toHaveBeenNthCalledWith(2, COACH_ID, tx);
      expect(view.days[0].slots).toEqual([{ startTime: '06:00', endTime: '12:00' }]);
    });

    it('writes one COACH_AVAILABILITY_UPDATED audit row with a short before/after summary', async () => {
      findWeekByCoachId
        .mockResolvedValueOnce([savedRow(1, '09:00', '10:00')])
        .mockResolvedValue([]);
      const days = week(day(6, [], false), day(7, [], false)); // 5 available days, 5 slots
      await saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days, meta });

      expect(createAuditLog).toHaveBeenCalledTimes(1);
      expect(createAuditLog).toHaveBeenCalledWith(tx, {
        userId: COACH_USER_ID,
        action: AuditAction.COACH_AVAILABILITY_UPDATED,
        email: 'coach@test.invalid',
        actorId: admin.id,
        actorRole: Role.ADMIN,
        details: {
          coachId: COACH_ID,
          before: { configured: true, availableDays: 1, slotCount: 1 },
          after: { configured: true, availableDays: 5, slotCount: 5 },
        },
        meta,
      });
    });

    it('reports an unconfigured coach as configured: false in the audit "before"', async () => {
      await saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days: week(), meta });
      expect(createAuditLog.mock.calls[0][1].details.before).toEqual({
        configured: false,
        availableDays: 0,
        slotCount: 0,
      });
    });

    it('writes only through the availability repository (no other table is touched)', async () => {
      await saveWeeklyAvailability({ actor: admin, coachId: COACH_ID, days: week(), meta });
      // The transaction client has no model delegates: any other table access would throw.
      expect(replaceWeek).toHaveBeenCalledTimes(1);
      expect(Object.keys(tx)).toEqual(['name']);
    });
  });
});
