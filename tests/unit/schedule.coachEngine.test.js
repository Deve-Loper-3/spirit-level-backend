const mockTx = { tx: true };

jest.mock('../../src/config/prisma', () => ({
  $transaction: jest.fn((cb) => cb(mockTx)),
  classSession: { findMany: jest.fn() },
}));
jest.mock('../../src/repositories/schedule.repository');
jest.mock('../../src/repositories/class.repository');
jest.mock('../../src/services/schedule.adapters');
jest.mock('../../src/services/coachSchedule.service', () => ({
  checkCoachesForInterval: jest.fn(),
}));
jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  lockCoachSchedule: jest.fn(),
}));
jest.mock('../../src/repositories/audit-log.repository', () => ({ createAuditLog: jest.fn() }));

const prisma = require('../../src/config/prisma');
const scheduleRepository = require('../../src/repositories/schedule.repository');
const classRepository = require('../../src/repositories/class.repository');
const { getBookingStats } = require('../../src/services/schedule.adapters');
const { checkCoachesForInterval } = require('../../src/services/coachSchedule.service');
const { lockCoachSchedule } = require('../../src/repositories/coachSchedule.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const {
  createSession,
  patchSession,
  restoreSession,
  sameIdSet,
} = require('../../src/services/schedule.service');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

const DAY = 24 * 60 * 60 * 1000;
const START = new Date(Date.now() + 3 * DAY);
const END = new Date(START.getTime() + 60 * 60 * 1000);
const admin = { id: 'admin-1', role: Role.ADMIN };

const classRecord = {
  id: 'class-1',
  name: 'Yoga',
  status: 'ACTIVE',
  timezone: 'Asia/Dubai',
  durationMin: 60,
  baseCapacity: 20,
  visibility: 'PUBLIC',
  coaches: [
    { coachId: 'coach-1', coach: { id: 'coach-1', userId: 'u1' } },
    { coachId: 'coach-2', coach: { id: 'coach-2', userId: 'u2' } },
  ],
};

const sessionRecord = (overrides = {}) => ({
  id: 'session-1',
  classId: 'class-1',
  slotId: null,
  startAt: START,
  endAt: END,
  capacity: 20,
  state: 'OPEN',
  version: 1,
  overriddenFields: [],
  overrideDetails: {},
  class: classRecord,
  coaches: [{ coachId: 'coach-1', coach: { id: 'coach-1', userId: 'u1' } }],
  ...overrides,
});

const conflict = (coachId, type = 'OUTSIDE_AVAILABILITY') => ({
  type,
  coachId,
  message: `${type} message`,
  conflictingItem: null,
});

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(mockTx));
  scheduleRepository.acquireClassAdvisoryLock.mockResolvedValue(true);
  scheduleRepository.findSessionAtStartTime.mockResolvedValue(null);
  scheduleRepository.findCoachOverlappingSessions.mockResolvedValue([]);
  scheduleRepository.findCoachesByIdsWithDetails.mockImplementation(async (ids) =>
    ids.map((id) => ({ id, status: 'ACTIVE', user: { status: 'ACTIVE' } })),
  );
  classRepository.findById.mockResolvedValue(classRecord);
  getBookingStats.mockResolvedValue({ bookedCount: 0, waitlistCount: 0 });
  checkCoachesForInterval.mockResolvedValue(new Map());
  scheduleRepository.createSession.mockImplementation(async (data, coachIds) => ({
    id: 'new-session',
    ...data,
    class: classRecord,
    coaches: coachIds.map((id) => ({ coachId: id, coach: { id, userId: `u-${id}` } })),
  }));
  scheduleRepository.updateSession.mockImplementation(async (id, data) => ({
    ...sessionRecord(),
    ...data,
    version: 2,
  }));
});

describe('sameIdSet', () => {
  it('compares as sets: order and duplicates do not matter', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIdSet(['a', 'a'], ['a'])).toBe(true);
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameIdSet([], [])).toBe(true);
  });
});

describe('createSession: the engine runs on the final coach set', () => {
  const payload = (extra = {}) => ({
    classId: 'class-1',
    startAt: START.toISOString(),
    endAt: END.toISOString(),
    ...extra,
  });

  it('checks the coaches inherited from the template, for the session interval, under the coach locks', async () => {
    await createSession({ payload: payload(), user: admin });
    expect(lockCoachSchedule.mock.calls.map((c) => c[0])).toEqual(['coach-1', 'coach-2']);
    expect(lockCoachSchedule).toHaveBeenCalledWith('coach-1', mockTx);
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      { coachIds: ['coach-1', 'coach-2'], startAt: START, endAt: END, excludeSessionId: undefined },
      mockTx,
    );
    // buffers are not sent: sessions have none
    expect(checkCoachesForInterval.mock.calls[0][0]).not.toHaveProperty('bufferBeforeMin');
  });

  it('checks the explicit coachIds instead of the template ones', async () => {
    await createSession({ payload: payload({ coachIds: ['coach-2'] }), user: admin });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['coach-2'] }),
      mockTx,
    );
  });

  it('runs AFTER validateCoachesForInterval and BEFORE the insert', async () => {
    await createSession({ payload: payload(), user: admin });
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(scheduleRepository.findCoachOverlappingSessions)).toBeLessThan(
      order(checkCoachesForInterval),
    );
    expect(order(checkCoachesForInterval)).toBeLessThan(order(scheduleRepository.createSession));
  });

  it('a conflict is a 409 COACH_CONFLICT with the S7 entries and nothing is inserted', async () => {
    checkCoachesForInterval.mockResolvedValue(
      new Map([
        ['coach-1', conflict('coach-1')],
        ['coach-2', null],
      ]),
    );
    await expect(createSession({ payload: payload(), user: admin })).rejects.toMatchObject({
      statusCode: 409,
      code: 'COACH_CONFLICT',
      message: 'OUTSIDE_AVAILABILITY message',
      details: { conflicts: [conflict('coach-1')] },
    });
    expect(scheduleRepository.createSession).not.toHaveBeenCalled();
  });

  it('several conflicts are all reported, with the generic message', async () => {
    checkCoachesForInterval.mockResolvedValue(
      new Map([
        ['coach-1', conflict('coach-1')],
        ['coach-2', conflict('coach-2', 'COACH_UNAVAILABLE')],
      ]),
    );
    const error = await createSession({ payload: payload(), user: admin }).catch((e) => e);
    expect(error.details.conflicts).toHaveLength(2);
    expect(error.message).toBe('One or more coaches have a scheduling conflict');
  });

  it('the old overlap check keeps its own error and the engine is not reached', async () => {
    scheduleRepository.findCoachOverlappingSessions.mockResolvedValue([
      { id: 's9', startAt: START, endAt: END },
    ]);
    await expect(createSession({ payload: payload(), user: admin })).rejects.toMatchObject({
      code: 'COACH_CONFLICT',
      details: {
        conflicts: [expect.objectContaining({ type: 'COACH_CONFLICT', sessionId: 's9' })],
      },
    });
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
  });

  it('a session without coaches calls neither the lock nor the engine', async () => {
    classRepository.findById.mockResolvedValue({ ...classRecord, coaches: [] });
    await createSession({ payload: payload(), user: admin });
    expect(lockCoachSchedule).not.toHaveBeenCalled();
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
  });
});

describe('patchSession', () => {
  beforeEach(() => scheduleRepository.findSessionById.mockResolvedValue(sessionRecord()));

  const patch = (payload, session) => {
    if (session) scheduleRepository.findSessionById.mockResolvedValue(session);
    return patchSession({
      sessionId: 'session-1',
      payload,
      user: admin,
      meta: { ipAddress: 'ip' },
    });
  };

  it('a changed coach set (replacement): the FINAL set is checked for the session interval, excluding the session', async () => {
    await patch({ coachIds: ['coach-2'], overrideReasons: { coachIds: 'Coach is sick' } });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      { coachIds: ['coach-2'], startAt: START, endAt: END, excludeSessionId: 'session-1' },
      mockTx,
    );
    expect(scheduleRepository.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.any(Object),
      ['coach-2'],
      mockTx,
    );
  });

  it('writes SESSION_COACH_REPLACED with the old and new ids, in the same transaction', async () => {
    await patch({ coachIds: ['coach-2'], overrideReasons: { coachIds: 'Coach is sick' } });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(mockTx, {
      action: AuditAction.SESSION_COACH_REPLACED,
      actorId: 'admin-1',
      actorRole: Role.ADMIN,
      details: {
        sessionId: 'session-1',
        classId: 'class-1',
        previousCoachIds: ['coach-1'],
        newCoachIds: ['coach-2'],
      },
      meta: { ipAddress: 'ip' },
    });
    expect(createAuditLog.mock.invocationCallOrder[0]).toBeGreaterThan(
      scheduleRepository.updateSession.mock.invocationCallOrder[0],
    );
  });

  it('adding a second coach also counts as a change and is audited', async () => {
    await patch({
      coachIds: ['coach-1', 'coach-2'],
      overrideReasons: { coachIds: 'Second coach' },
    });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['coach-1', 'coach-2'] }),
      mockTx,
    );
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('a conflict rejects the whole PATCH: nothing updated, nothing audited', async () => {
    checkCoachesForInterval.mockResolvedValue(
      new Map([['coach-2', conflict('coach-2', 'COACH_UNAVAILABLE')]]),
    );
    await expect(
      patch({ coachIds: ['coach-2'], overrideReasons: { coachIds: 'x' } }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'COACH_CONFLICT' });
    expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('the same coaches resent (any order) and the same time: no engine, no audit', async () => {
    await patch({
      coachIds: ['coach-1'],
      capacity: 25,
      overrideReasons: { coachIds: 'same', capacity: 'more' },
    });
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
    expect(lockCoachSchedule).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
  });

  it('an unrelated edit (capacity, description) never runs the engine', async () => {
    await patch({
      capacity: 30,
      description: 'New text',
      overrideReasons: { capacity: 'x', description: 'y' },
    });
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('a changed time re-checks the EXISTING coaches for the new interval, with no audit', async () => {
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);
    await patch({
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      overrideReasons: { startAt: 'Moved', endAt: 'Moved' },
    });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      { coachIds: ['coach-1'], startAt: newStart, endAt: newEnd, excludeSessionId: 'session-1' },
      mockTx,
    );
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('startAt resent with the stored value is not a time change', async () => {
    await patch({ startAt: START.toISOString(), overrideReasons: { startAt: 'same' } });
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
  });

  it('a cancelled session is not re-checked on a time change (restore does that)', async () => {
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000);
    await patch(
      {
        startAt: newStart.toISOString(),
        endAt: new Date(newStart.getTime() + 3600000).toISOString(),
        overrideReasons: { startAt: 'x', endAt: 'x' },
      },
      sessionRecord({ state: 'CANCELLED' }),
    );
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
  });

  it('a version conflict (updateSession returns null) writes no audit', async () => {
    scheduleRepository.updateSession.mockResolvedValue(null);
    await expect(
      patch({ coachIds: ['coach-2'], overrideReasons: { coachIds: 'x' } }),
    ).rejects.toMatchObject({ code: 'SESSION_VERSION_CONFLICT' });
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('patchSession: replacement with a coach that is NOT on the class template', () => {
  // coach-3 is active but is not one of classRecord.coaches (coach-1, coach-2)
  beforeEach(() => scheduleRepository.findSessionById.mockResolvedValue(sessionRecord()));
  const replaceWith = (coachIds) =>
    patchSession({
      sessionId: 'session-1',
      payload: { coachIds, overrideReasons: { coachIds: 'Covering coach' } },
      user: admin,
      meta: {},
    });

  it('passes the old validation, goes through the engine and is saved on that session only', async () => {
    await replaceWith(['coach-3']);
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      { coachIds: ['coach-3'], startAt: START, endAt: END, excludeSessionId: 'session-1' },
      mockTx,
    );
    expect(scheduleRepository.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.any(Object),
      ['coach-3'],
      mockTx,
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: AuditAction.SESSION_COACH_REPLACED,
        details: expect.objectContaining({
          previousCoachIds: ['coach-1'],
          newCoachIds: ['coach-3'],
        }),
      }),
    );
  });

  it('never touches the class template or other sessions: only updateSession of this session runs', async () => {
    await replaceWith(['coach-3']);
    expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.replaceSessionCoaches).not.toHaveBeenCalled();
    expect(classRepository.findById).toHaveBeenCalledTimes(0); // the template is not even read
    expect(classRecord.coaches.map((c) => c.coachId)).toEqual(['coach-1', 'coach-2']);
  });

  it('an unknown or inactive coach is still rejected (400, nothing saved)', async () => {
    scheduleRepository.findCoachesByIdsWithDetails.mockResolvedValue([]);
    await expect(replaceWith(['coach-3'])).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    scheduleRepository.findCoachesByIdsWithDetails.mockResolvedValue([
      { id: 'coach-3', status: 'INACTIVE', user: { status: 'ACTIVE' } },
    ]);
    await expect(replaceWith(['coach-3'])).rejects.toMatchObject({ statusCode: 400 });
    scheduleRepository.findCoachesByIdsWithDetails.mockResolvedValue([
      { id: 'coach-3', status: 'ACTIVE', user: { status: 'DISABLED' } },
    ]);
    await expect(replaceWith(['coach-3'])).rejects.toMatchObject({ statusCode: 400 });
    expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
  });

  it('the S7 engine is still the gate: a conflict is a 409 and nothing is saved or audited', async () => {
    checkCoachesForInterval.mockResolvedValue(
      new Map([['coach-3', conflict('coach-3', 'AVAILABILITY_NOT_SET')]]),
    );
    await expect(replaceWith(['coach-3'])).rejects.toMatchObject({
      statusCode: 409,
      code: 'COACH_CONFLICT',
      details: { conflicts: [expect.objectContaining({ type: 'AVAILABILITY_NOT_SET' })] },
    });
    expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('a later time-only PATCH of that session keeps working (the stored coach is off-template)', async () => {
    const offTemplate = sessionRecord({
      coaches: [{ coachId: 'coach-3', coach: { id: 'coach-3', userId: 'u3' } }],
    });
    scheduleRepository.findSessionById.mockResolvedValue(offTemplate);
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000);
    await patchSession({
      sessionId: 'session-1',
      payload: {
        startAt: newStart.toISOString(),
        endAt: new Date(newStart.getTime() + 3600000).toISOString(),
        overrideReasons: { startAt: 'Moved', endAt: 'Moved' },
      },
      user: admin,
      meta: {},
    });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['coach-3'] }),
      mockTx,
    );
    expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
  });
});

describe('the template rule still holds where it was not asked to change', () => {
  it('createSession rejects a coach that is not on the class template (400)', async () => {
    await expect(
      createSession({
        payload: {
          classId: 'class-1',
          startAt: START.toISOString(),
          endAt: END.toISOString(),
          coachIds: ['coach-3'],
        },
        user: admin,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(checkCoachesForInterval).not.toHaveBeenCalled();
    expect(scheduleRepository.createSession).not.toHaveBeenCalled();
  });
});

describe('restoreSession', () => {
  const cancelled = () => sessionRecord({ state: 'CANCELLED', overriddenFields: ['cancel'] });

  it('re-checks the session coaches for the session interval, excluding itself', async () => {
    scheduleRepository.findSessionById.mockResolvedValue(cancelled());
    await restoreSession({ sessionId: 'session-1', user: admin });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      { coachIds: ['coach-1'], startAt: START, endAt: END, excludeSessionId: 'session-1' },
      mockTx,
    );
    expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
  });

  it('a stored coach that is not on the class template (a replacement) can be restored', async () => {
    scheduleRepository.findSessionById.mockResolvedValue(
      sessionRecord({
        state: 'CANCELLED',
        overriddenFields: ['cancel', 'coachIds'],
        coaches: [{ coachId: 'coach-3', coach: { id: 'coach-3', userId: 'u3' } }],
      }),
    );
    await restoreSession({ sessionId: 'session-1', user: admin });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['coach-3'], excludeSessionId: 'session-1' }),
      mockTx,
    );
    expect(scheduleRepository.updateSession).toHaveBeenCalledTimes(1);
  });

  it('a conflict keeps the session cancelled', async () => {
    scheduleRepository.findSessionById.mockResolvedValue(cancelled());
    checkCoachesForInterval.mockResolvedValue(
      new Map([['coach-1', conflict('coach-1', 'COACH_UNAVAILABLE')]]),
    );
    await expect(restoreSession({ sessionId: 'session-1', user: admin })).rejects.toMatchObject({
      statusCode: 409,
      code: 'COACH_CONFLICT',
    });
    expect(scheduleRepository.updateSession).not.toHaveBeenCalled();
  });
});
