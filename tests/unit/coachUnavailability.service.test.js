jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({ $transaction: jest.fn() }));
jest.mock('../../src/repositories/coach.repository', () => ({ findCoachById: jest.fn() }));
jest.mock('../../src/repositories/coachUnavailability.repository', () => ({
  findUnavailabilityById: jest.fn(),
  listUnavailability: jest.fn(),
  findOverlappingUnavailability: jest.fn(),
  lockCoachUnavailability: jest.fn(),
  createUnavailability: jest.fn(),
  updateUnavailability: jest.fn(),
  deleteUnavailability: jest.fn(),
  findAssignedSessionsInWindow: jest.fn(),
  findLeaveOfCoaches: jest.fn(),
}));
jest.mock('../../src/repositories/audit-log.repository', () => ({ createAuditLog: jest.fn() }));

const prisma = require('../../src/config/prisma');
const { findCoachById } = require('../../src/repositories/coach.repository');
const repo = require('../../src/repositories/coachUnavailability.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const service = require('../../src/services/coachUnavailability.service');
const { Messages } = require('../../src/constants/messages');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

// "Today" is 2026-11-11 in Dubai (08:00 UTC = 12:00 Dubai). Only Date is faked, so promises run.
const NOW = new Date('2026-11-11T08:00:00.000Z');
const TODAY = '2026-11-11';

const COACH_ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const OTHER_COACH_ID = '9a1b2c3d-0000-4000-8000-000000000001';
const THIRD_COACH_ID = '9a1b2c3d-0000-4000-8000-000000000002';
const LEAVE_ID = '7e7e7e7e-0000-4000-8000-000000000009';
const COACH_USER_ID = 'user-of-coach';
const coachRow = { id: COACH_ID, user: { id: COACH_USER_ID, email: 'coach@test.invalid' } };

const admin = { id: 'admin-id', role: Role.ADMIN };
const ownCoach = { id: COACH_USER_ID, role: Role.COACH };
const otherCoach = { id: 'someone-else', role: Role.COACH };
const member = { id: 'member-id', role: Role.MEMBER };

const dateOnly = (d) => new Date(`${d}T00:00:00.000Z`);

const leaveRow = (startDate, endDate, overrides = {}) => ({
  id: LEAVE_ID,
  coachId: COACH_ID,
  startDate: dateOnly(startDate),
  endDate: dateOnly(endDate),
  reason: 'Sick leave',
  note: null,
  createdAt: new Date('2026-11-01T08:00:00.000Z'),
  updatedAt: new Date('2026-11-01T08:00:00.000Z'),
  ...overrides,
});

const sessionRow = (id, startAt, coachIds) => ({
  id,
  classId: `class-of-${id}`,
  startAt: new Date(startAt),
  endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000),
  class: { name: `Class ${id}` },
  coaches: coachIds.map((coachId) => ({ coachId })),
});

const thrownBy = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
};

const errorsOf = (err) => err.details;

describe('coachUnavailability.service', () => {
  const tx = { name: 'tx' };

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
      ],
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    findCoachById.mockResolvedValue(coachRow);
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    repo.findOverlappingUnavailability.mockResolvedValue(null);
    repo.findAssignedSessionsInWindow.mockResolvedValue({ rows: [], total: 0 });
    repo.findLeaveOfCoaches.mockResolvedValue([]);
  });

  describe('assertCreateDates', () => {
    it('accepts a leave that starts today or later', () => {
      expect(() =>
        service.assertCreateDates({ startDate: TODAY, endDate: TODAY }, TODAY),
      ).not.toThrow();
      expect(() =>
        service.assertCreateDates({ startDate: '2026-12-01', endDate: '2026-12-05' }, TODAY),
      ).not.toThrow();
    });

    it('rejects a start date in the past with a 400 on startDate', () => {
      const err = (() => {
        try {
          service.assertCreateDates({ startDate: '2026-11-10', endDate: '2026-11-20' }, TODAY);
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(errorsOf(err)).toEqual([
        { field: 'startDate', message: Messages.UNAVAILABILITY_START_IN_PAST(TODAY) },
      ]);
    });

    it('rejects an end date before the start date with a 400 on endDate', () => {
      expect(() =>
        service.assertCreateDates({ startDate: '2026-12-05', endDate: '2026-12-01' }, TODAY),
      ).toThrow(Messages.UNAVAILABILITY_END_BEFORE_START);
    });
  });

  describe('resolveUpdate', () => {
    const upcoming = leaveRow('2026-12-01', '2026-12-05');
    const ongoing = leaveRow('2026-11-09', '2026-11-15');
    const ended = leaveRow('2026-11-01', '2026-11-10');

    it('merges a patch with the stored row', () => {
      expect(service.resolveUpdate(upcoming, { reason: 'Holiday' }, TODAY)).toEqual({
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        reason: 'Holiday',
        note: null,
      });
    });

    it('keeps the stored note unless a note is sent, and clears it with null', () => {
      const withNote = leaveRow('2026-12-01', '2026-12-05', { note: 'flu' });
      expect(service.resolveUpdate(withNote, { reason: 'x' }, TODAY).note).toBe('flu');
      expect(service.resolveUpdate(withNote, { note: null }, TODAY).note).toBeNull();
    });

    it('checks end >= start on the MERGED dates (patch has only startDate)', () => {
      const err = (() => {
        try {
          service.resolveUpdate(upcoming, { startDate: '2026-12-09' }, TODAY);
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(err.statusCode).toBe(400);
      expect(errorsOf(err)).toEqual([
        { field: 'endDate', message: Messages.UNAVAILABILITY_END_BEFORE_START },
      ]);
    });

    it('checks end >= start on the MERGED dates (patch has only endDate)', () => {
      expect(() => service.resolveUpdate(upcoming, { endDate: '2026-11-30' }, TODAY)).toThrow(
        Messages.UNAVAILABILITY_END_BEFORE_START,
      );
    });

    it('lets a leave that has not started move to a start date of today or later', () => {
      expect(
        service.resolveUpdate(upcoming, { startDate: TODAY, endDate: '2026-12-05' }, TODAY)
          .startDate,
      ).toBe(TODAY);
    });

    it('rejects moving a leave that has not started into the past', () => {
      expect(() =>
        service.resolveUpdate(upcoming, { startDate: '2026-11-05', endDate: '2026-12-05' }, TODAY),
      ).toThrow(Messages.UNAVAILABILITY_START_IN_PAST(TODAY));
    });

    it('locks startDate once the leave has started', () => {
      expect(() => service.resolveUpdate(ongoing, { startDate: '2026-11-12' }, TODAY)).toThrow(
        Messages.UNAVAILABILITY_START_LOCKED,
      );
    });

    it('does not treat a startDate equal to the stored one as a change (started leave)', () => {
      expect(
        service.resolveUpdate(ongoing, { startDate: '2026-11-09', endDate: '2026-11-20' }, TODAY)
          .endDate,
      ).toBe('2026-11-20');
    });

    it('lets a started leave be extended or shortened down to today', () => {
      expect(service.resolveUpdate(ongoing, { endDate: '2026-12-31' }, TODAY).endDate).toBe(
        '2026-12-31',
      );
      expect(service.resolveUpdate(ongoing, { endDate: TODAY }, TODAY).endDate).toBe(TODAY);
    });

    it('rejects shortening a started leave to a day in the past', () => {
      expect(() => service.resolveUpdate(ongoing, { endDate: '2026-11-10' }, TODAY)).toThrow(
        Messages.UNAVAILABILITY_END_IN_PAST(TODAY),
      );
    });

    it('lets reason and note change on a started leave', () => {
      expect(service.resolveUpdate(ongoing, { reason: 'Surgery', note: 'x' }, TODAY)).toMatchObject(
        {
          reason: 'Surgery',
          note: 'x',
        },
      );
    });

    it('rejects any edit of a leave that has already ended with 409 UNAVAILABILITY_PAST_IMMUTABLE', () => {
      const err = (() => {
        try {
          service.resolveUpdate(ended, { reason: 'x' }, TODAY);
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('UNAVAILABILITY_PAST_IMMUTABLE');
    });

    it('treats a leave that ends today as still ongoing (editable)', () => {
      const endsToday = leaveRow('2026-11-05', TODAY);
      expect(service.resolveUpdate(endsToday, { reason: 'x' }, TODAY).reason).toBe('x');
    });
  });

  describe('computeCoverage', () => {
    const timezone = 'Asia/Dubai';
    // 2026-12-02 10:00 Dubai
    const session = sessionRow('s1', '2026-12-02T06:00:00.000Z', [COACH_ID, OTHER_COACH_ID]);
    const leaveOf = (entries) => new Map(entries);

    it('is COVERED when another assigned coach is not on leave that day', () => {
      expect(
        service.computeCoverage({
          session,
          coachId: COACH_ID,
          leaveByCoach: leaveOf([]),
          timezone,
        }),
      ).toBe('COVERED');
    });

    it('is UNCOVERED when the session has no other coach', () => {
      const solo = sessionRow('s2', '2026-12-02T06:00:00.000Z', [COACH_ID]);
      expect(
        service.computeCoverage({
          session: solo,
          coachId: COACH_ID,
          leaveByCoach: leaveOf([]),
          timezone,
        }),
      ).toBe('UNCOVERED');
    });

    it('is UNCOVERED when the only other coach is on leave that day (inclusive dates)', () => {
      const leaveByCoach = leaveOf([
        [OTHER_COACH_ID, [{ startDate: '2026-12-02', endDate: '2026-12-02' }]],
      ]);
      expect(service.computeCoverage({ session, coachId: COACH_ID, leaveByCoach, timezone })).toBe(
        'UNCOVERED',
      );
    });

    it("is COVERED when the other coach's leave is on a different day", () => {
      const leaveByCoach = leaveOf([
        [OTHER_COACH_ID, [{ startDate: '2026-12-03', endDate: '2026-12-09' }]],
      ]);
      expect(service.computeCoverage({ session, coachId: COACH_ID, leaveByCoach, timezone })).toBe(
        'COVERED',
      );
    });

    it('is COVERED when at least one of several other coaches is free', () => {
      const three = sessionRow('s3', '2026-12-02T06:00:00.000Z', [
        COACH_ID,
        OTHER_COACH_ID,
        THIRD_COACH_ID,
      ]);
      const leaveByCoach = leaveOf([
        [OTHER_COACH_ID, [{ startDate: '2026-12-01', endDate: '2026-12-05' }]],
      ]);
      expect(
        service.computeCoverage({ session: three, coachId: COACH_ID, leaveByCoach, timezone }),
      ).toBe('COVERED');
    });

    it('reads the session day in the facility timezone, not in UTC', () => {
      // 2026-12-02 22:00 UTC is 2026-12-03 02:00 in Dubai.
      const late = sessionRow('s4', '2026-12-02T22:00:00.000Z', [COACH_ID, OTHER_COACH_ID]);
      const leaveByCoach = leaveOf([
        [OTHER_COACH_ID, [{ startDate: '2026-12-03', endDate: '2026-12-03' }]],
      ]);
      expect(
        service.computeCoverage({ session: late, coachId: COACH_ID, leaveByCoach, timezone }),
      ).toBe('UNCOVERED');
    });
  });

  describe('findAffectedSessions', () => {
    it('returns an empty result without any query for a range that is entirely in the past', async () => {
      const result = await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        now: NOW,
      });
      expect(result).toEqual({ affectedSessions: [], affectedTotal: 0 });
      expect(repo.findAssignedSessionsInWindow).not.toHaveBeenCalled();
    });

    it('queries the facility-day window, starting at now when the range already began', async () => {
      await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-11-09',
        endDate: '2026-11-12',
        now: NOW,
      });
      const args = repo.findAssignedSessionsInWindow.mock.calls[0][0];
      expect(args.coachId).toBe(COACH_ID);
      expect(args.take).toBe(100);
      expect(args.from).toEqual(NOW);
      // 2026-11-13 00:00 Dubai (UTC+4) = 2026-11-12 20:00 UTC
      expect(args.to).toEqual(new Date('2026-11-12T20:00:00.000Z'));
    });

    it('starts the window at the start of the first day for a future range', async () => {
      await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        now: NOW,
      });
      const args = repo.findAssignedSessionsInWindow.mock.calls[0][0];
      expect(args.from).toEqual(new Date('2026-11-30T20:00:00.000Z'));
    });

    it('does not query the other coaches leave when there are no sessions', async () => {
      const result = await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        now: NOW,
      });
      expect(result).toEqual({ affectedSessions: [], affectedTotal: 0 });
      expect(repo.findLeaveOfCoaches).not.toHaveBeenCalled();
    });

    it('does not query leave when the coach is the only coach on every session', async () => {
      repo.findAssignedSessionsInWindow.mockResolvedValue({
        rows: [sessionRow('s1', '2026-12-01T06:00:00.000Z', [COACH_ID])],
        total: 1,
      });
      const result = await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        now: NOW,
      });
      expect(repo.findLeaveOfCoaches).not.toHaveBeenCalled();
      expect(result.affectedSessions[0].coverage).toBe('UNCOVERED');
    });

    it('loads the leave of all other coaches with ONE query and maps COVERED / UNCOVERED', async () => {
      repo.findAssignedSessionsInWindow.mockResolvedValue({
        rows: [
          sessionRow('s1', '2026-12-01T06:00:00.000Z', [COACH_ID, OTHER_COACH_ID]),
          sessionRow('s2', '2026-12-02T06:00:00.000Z', [COACH_ID, OTHER_COACH_ID]),
          sessionRow('s3', '2026-12-02T08:00:00.000Z', [COACH_ID, THIRD_COACH_ID]),
        ],
        total: 3,
      });
      repo.findLeaveOfCoaches.mockResolvedValue([
        {
          coachId: OTHER_COACH_ID,
          startDate: dateOnly('2026-12-02'),
          endDate: dateOnly('2026-12-02'),
        },
      ]);

      const result = await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        now: NOW,
      });

      expect(repo.findLeaveOfCoaches).toHaveBeenCalledTimes(1);
      expect(repo.findLeaveOfCoaches).toHaveBeenCalledWith({
        coachIds: [OTHER_COACH_ID, THIRD_COACH_ID],
        startDate: '2026-12-01',
        endDate: '2026-12-05',
      });
      expect(result.affectedTotal).toBe(3);
      expect(result.affectedSessions.map((s) => [s.sessionId, s.coverage])).toEqual([
        ['s1', 'COVERED'],
        ['s2', 'UNCOVERED'],
        ['s3', 'COVERED'],
      ]);
      expect(result.affectedSessions[0]).toEqual({
        sessionId: 's1',
        classId: 'class-of-s1',
        title: 'Class s1',
        startAt: '2026-12-01T06:00:00.000Z',
        endAt: '2026-12-01T07:00:00.000Z',
        coverage: 'COVERED',
      });
    });

    it('reports the full count in affectedTotal when the list is capped', async () => {
      repo.findAssignedSessionsInWindow.mockResolvedValue({
        rows: [sessionRow('s1', '2026-12-01T06:00:00.000Z', [COACH_ID])],
        total: 250,
      });
      const result = await service.findAffectedSessions({
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-30',
        now: NOW,
      });
      expect(result.affectedSessions).toHaveLength(1);
      expect(result.affectedTotal).toBe(250);
    });
  });

  describe('listUnavailability', () => {
    it('lets a manager and the coach themselves read, and returns the page envelope', async () => {
      repo.listUnavailability.mockResolvedValue({
        rows: [leaveRow('2026-12-01', '2026-12-05')],
        total: 41,
      });
      for (const caller of [admin, ownCoach]) {
        const result = await service.listUnavailability({
          caller,
          coachId: COACH_ID,
          query: { page: 2, limit: 20 },
        });
        expect(result.pagination).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
        expect(result.data[0]).toMatchObject({
          id: LEAVE_ID,
          coachId: COACH_ID,
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          note: null,
        });
      }
    });

    it('passes from, to, page and limit to the repository', async () => {
      repo.listUnavailability.mockResolvedValue({ rows: [], total: 0 });
      await service.listUnavailability({
        caller: admin,
        coachId: COACH_ID,
        query: { page: 1, limit: 5, from: '2026-12-01', to: '2026-12-31' },
      });
      expect(repo.listUnavailability).toHaveBeenCalledWith({
        coachId: COACH_ID,
        from: '2026-12-01',
        to: '2026-12-31',
        page: 1,
        limit: 5,
      });
    });

    it('is 403 for another coach and for a member, 404 for an unknown coach', async () => {
      for (const caller of [otherCoach, member]) {
        const err = await thrownBy(() =>
          service.listUnavailability({ caller, coachId: COACH_ID, query: { page: 1, limit: 20 } }),
        );
        expect(err.statusCode).toBe(403);
      }
      findCoachById.mockResolvedValue(null);
      const err = await thrownBy(() =>
        service.listUnavailability({
          caller: admin,
          coachId: COACH_ID,
          query: { page: 1, limit: 20 },
        }),
      );
      expect(err.code).toBe('COACH_NOT_FOUND');
      expect(repo.listUnavailability).not.toHaveBeenCalled();
    });
  });

  describe('createUnavailability', () => {
    const input = {
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      reason: 'Sick leave',
      note: null,
    };
    const meta = { ipAddress: '1.1.1.1' };

    beforeEach(() => {
      repo.createUnavailability.mockResolvedValue(leaveRow('2026-12-01', '2026-12-05'));
    });

    it('is 403 for a coach and a member before anything is read', async () => {
      for (const actor of [ownCoach, member]) {
        const err = await thrownBy(() =>
          service.createUnavailability({ actor, coachId: COACH_ID, input, meta }),
        );
        expect(err.statusCode).toBe(403);
      }
      expect(findCoachById).not.toHaveBeenCalled();
    });

    it('is 404 for an unknown coach', async () => {
      findCoachById.mockResolvedValue(null);
      const err = await thrownBy(() =>
        service.createUnavailability({ actor: admin, coachId: COACH_ID, input, meta }),
      );
      expect(err.code).toBe('COACH_NOT_FOUND');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a past start date before opening a transaction', async () => {
      const err = await thrownBy(() =>
        service.createUnavailability({
          actor: admin,
          coachId: COACH_ID,
          input: { ...input, startDate: '2026-11-10' },
          meta,
        }),
      );
      expect(err.statusCode).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an overlapping leave with 409 naming the existing range, and writes nothing', async () => {
      repo.findOverlappingUnavailability.mockResolvedValue(
        leaveRow('2026-12-04', '2026-12-10', { id: 'existing-id' }),
      );
      const err = await thrownBy(() =>
        service.createUnavailability({ actor: admin, coachId: COACH_ID, input, meta }),
      );
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('UNAVAILABILITY_OVERLAP');
      expect(err.message).toBe(Messages.UNAVAILABILITY_OVERLAP_DETAIL('2026-12-04', '2026-12-10'));
      expect(err.details).toEqual({
        conflict: { id: 'existing-id', startDate: '2026-12-04', endDate: '2026-12-10' },
      });
      expect(repo.createUnavailability).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('takes the coach lock first, checks overlap in the same transaction and does not exclude any row', async () => {
      await service.createUnavailability({ actor: admin, coachId: COACH_ID, input, meta });
      expect(repo.lockCoachUnavailability).toHaveBeenCalledWith(COACH_ID, tx);
      expect(repo.lockCoachUnavailability.mock.invocationCallOrder[0]).toBeLessThan(
        repo.findOverlappingUnavailability.mock.invocationCallOrder[0],
      );
      expect(repo.findOverlappingUnavailability).toHaveBeenCalledWith(
        { coachId: COACH_ID, startDate: '2026-12-01', endDate: '2026-12-05', excludeId: undefined },
        tx,
      );
    });

    it('creates the leave and one audit row in the same transaction, with a short summary', async () => {
      await service.createUnavailability({ actor: admin, coachId: COACH_ID, input, meta });
      expect(repo.createUnavailability).toHaveBeenCalledWith({ coachId: COACH_ID, ...input }, tx);
      expect(createAuditLog).toHaveBeenCalledTimes(1);
      expect(createAuditLog).toHaveBeenCalledWith(tx, {
        userId: COACH_USER_ID,
        action: AuditAction.COACH_UNAVAILABILITY_CREATED,
        email: 'coach@test.invalid',
        actorId: 'admin-id',
        actorRole: Role.ADMIN,
        details: {
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          reason: 'Sick leave',
        },
        meta,
      });
    });

    it('returns the leave with affectedSessions and affectedTotal, and changes no session', async () => {
      repo.findAssignedSessionsInWindow.mockResolvedValue({
        rows: [sessionRow('s1', '2026-12-02T06:00:00.000Z', [COACH_ID])],
        total: 1,
      });
      const result = await service.createUnavailability({
        actor: admin,
        coachId: COACH_ID,
        input,
        meta,
      });
      expect(result).toMatchObject({
        id: LEAVE_ID,
        coachId: COACH_ID,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        reason: 'Sick leave',
        note: null,
        affectedTotal: 1,
      });
      expect(result.affectedSessions).toHaveLength(1);
    });
  });

  describe('updateUnavailability', () => {
    const meta = {};

    beforeEach(() => {
      repo.findUnavailabilityById.mockResolvedValue(leaveRow('2026-12-01', '2026-12-05'));
      repo.updateUnavailability.mockImplementation(async (id, merged) =>
        leaveRow(merged.startDate, merged.endDate, { reason: merged.reason, note: merged.note }),
      );
    });

    it('is 403 for a coach', async () => {
      const err = await thrownBy(() =>
        service.updateUnavailability({
          actor: ownCoach,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          patch: { reason: 'x' },
          meta,
        }),
      );
      expect(err.statusCode).toBe(403);
    });

    it('is 404 UNAVAILABILITY_NOT_FOUND when the id is not one of this coach', async () => {
      repo.findUnavailabilityById.mockResolvedValue(null);
      const err = await thrownBy(() =>
        service.updateUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          patch: { reason: 'x' },
          meta,
        }),
      );
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('UNAVAILABILITY_NOT_FOUND');
      expect(repo.findUnavailabilityById).toHaveBeenCalledWith(COACH_ID, LEAVE_ID, tx);
      expect(repo.updateUnavailability).not.toHaveBeenCalled();
    });

    it('checks the overlap against the MERGED dates and excludes the row being edited', async () => {
      await service.updateUnavailability({
        actor: admin,
        coachId: COACH_ID,
        unavailabilityId: LEAVE_ID,
        patch: { endDate: '2026-12-20' },
        meta,
      });
      expect(repo.findOverlappingUnavailability).toHaveBeenCalledWith(
        { coachId: COACH_ID, startDate: '2026-12-01', endDate: '2026-12-20', excludeId: LEAVE_ID },
        tx,
      );
    });

    it('rejects an overlap with another leave with 409, and does not update', async () => {
      repo.findOverlappingUnavailability.mockResolvedValue(
        leaveRow('2026-12-10', '2026-12-12', { id: 'other-leave' }),
      );
      const err = await thrownBy(() =>
        service.updateUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          patch: { endDate: '2026-12-11' },
          meta,
        }),
      );
      expect(err.code).toBe('UNAVAILABILITY_OVERLAP');
      expect(err.message).toContain('2026-12-10');
      expect(err.message).toContain('2026-12-12');
      expect(repo.updateUnavailability).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('writes the merged values, one audit row with before / after / changed, and returns the impact', async () => {
      const result = await service.updateUnavailability({
        actor: admin,
        coachId: COACH_ID,
        unavailabilityId: LEAVE_ID,
        patch: { endDate: '2026-12-08', note: 'back later' },
        meta,
      });
      expect(repo.updateUnavailability).toHaveBeenCalledWith(
        LEAVE_ID,
        {
          startDate: '2026-12-01',
          endDate: '2026-12-08',
          reason: 'Sick leave',
          note: 'back later',
        },
        tx,
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: AuditAction.COACH_UNAVAILABILITY_UPDATED,
          details: {
            coachId: COACH_ID,
            unavailabilityId: LEAVE_ID,
            before: { startDate: '2026-12-01', endDate: '2026-12-05' },
            after: { startDate: '2026-12-01', endDate: '2026-12-08' },
            changed: ['endDate', 'note'],
          },
        }),
      );
      expect(result.endDate).toBe('2026-12-08');
      expect(result).toHaveProperty('affectedSessions');
      expect(result).toHaveProperty('affectedTotal');
    });

    it('rejects an edit of a leave that has ended with 409 and writes nothing', async () => {
      repo.findUnavailabilityById.mockResolvedValue(leaveRow('2026-11-01', '2026-11-05'));
      const err = await thrownBy(() =>
        service.updateUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          patch: { reason: 'x' },
          meta,
        }),
      );
      expect(err.code).toBe('UNAVAILABILITY_PAST_IMMUTABLE');
      expect(repo.updateUnavailability).not.toHaveBeenCalled();
    });
  });

  describe('deleteUnavailability', () => {
    const meta = {};

    it('is 403 for a coach', async () => {
      const err = await thrownBy(() =>
        service.deleteUnavailability({
          actor: ownCoach,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          meta,
        }),
      );
      expect(err.statusCode).toBe(403);
    });

    it('is 404 when the leave is not one of this coach', async () => {
      repo.findUnavailabilityById.mockResolvedValue(null);
      const err = await thrownBy(() =>
        service.deleteUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          meta,
        }),
      );
      expect(err.code).toBe('UNAVAILABILITY_NOT_FOUND');
      expect(repo.deleteUnavailability).not.toHaveBeenCalled();
    });

    it('refuses to delete a leave that has already ended (409)', async () => {
      repo.findUnavailabilityById.mockResolvedValue(leaveRow('2026-11-01', '2026-11-10'));
      const err = await thrownBy(() =>
        service.deleteUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          meta,
        }),
      );
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('UNAVAILABILITY_PAST_IMMUTABLE');
      expect(repo.deleteUnavailability).not.toHaveBeenCalled();
    });

    it('deletes an ongoing leave (ends today) and a future leave, with one audit row each', async () => {
      for (const [start, end] of [
        ['2026-11-05', TODAY],
        ['2026-12-01', '2026-12-05'],
      ]) {
        jest.clearAllMocks();
        repo.findUnavailabilityById.mockResolvedValue(leaveRow(start, end));
        const result = await service.deleteUnavailability({
          actor: admin,
          coachId: COACH_ID,
          unavailabilityId: LEAVE_ID,
          meta,
        });
        expect(result).toEqual({ id: LEAVE_ID });
        expect(repo.deleteUnavailability).toHaveBeenCalledWith(LEAVE_ID, tx);
        expect(createAuditLog).toHaveBeenCalledWith(
          tx,
          expect.objectContaining({
            action: AuditAction.COACH_UNAVAILABILITY_DELETED,
            details: {
              coachId: COACH_ID,
              unavailabilityId: LEAVE_ID,
              startDate: start,
              endDate: end,
            },
          }),
        );
      }
    });
  });
});
