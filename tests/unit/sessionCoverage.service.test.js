jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/repositories/sessionCoverage.repository', () => ({
  findLeaveInRange: jest.fn(),
  findSessionsWithCoaches: jest.fn(),
}));
jest.mock('../../src/repositories/coach.repository', () => ({ findCoachByUserId: jest.fn() }));

const repo = require('../../src/repositories/sessionCoverage.repository');
const { findCoachByUserId } = require('../../src/repositories/coach.repository');
const {
  listSessionCoverage,
  splitCoaches,
  toCoverageEntry,
} = require('../../src/services/sessionCoverage.service');
const { Role } = require('../../src/constants/roles');

const DAY1 = '2026-12-01';
const startAt = (date, hhmm = '10:00') => new Date(`${date}T${hhmm}:00+04:00`);
const assignment = (coachId, fullName) => ({ coachId, coach: { user: { fullName } } });
const session = (id, coaches, date = DAY1) => ({
  id,
  classId: `class-${id}`,
  startAt: startAt(date),
  endAt: startAt(date, '11:00'),
  class: { name: `Class ${id}` },
  coaches,
});
const leave = (coachId, startDate, endDate, id = `leave-${coachId}`) => ({
  id,
  coachId,
  startDate,
  endDate,
  reason: 'Sick',
});
const byCoach = (rows) => {
  const map = new Map();
  rows.forEach((r) => map.set(r.coachId, [...(map.get(r.coachId) ?? []), r]));
  return map;
};
const admin = { id: 'admin', role: Role.ADMIN };
const query = { from: DAY1, to: '2026-12-07', page: 1, limit: 20 };

beforeEach(() => {
  jest.resetAllMocks();
  repo.findLeaveInRange.mockResolvedValue([]);
  repo.findSessionsWithCoaches.mockResolvedValue([]);
});

describe('splitCoaches', () => {
  it('separates the coaches on leave that facility day from the free ones', () => {
    const s = session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]);
    const out = splitCoaches({
      session: s,
      leavesByCoach: byCoach([leave('a', DAY1, DAY1)]),
      timezone: 'Asia/Dubai',
    });
    expect(out.unavailable).toEqual([
      {
        coachId: 'a',
        fullName: 'Amal',
        leave: { id: 'leave-a', startDate: DAY1, endDate: DAY1, reason: 'Sick' },
      },
    ]);
    expect(out.covering).toEqual([{ coachId: 'b', fullName: 'Basma' }]);
  });

  it('a leave on another day does not count (inclusive dates)', () => {
    const s = session('s1', [assignment('a', 'Amal')]);
    const leaves = byCoach([leave('a', '2026-12-02', '2026-12-05')]);
    expect(
      splitCoaches({ session: s, leavesByCoach: leaves, timezone: 'Asia/Dubai' }).unavailable,
    ).toEqual([]);
    const onLastDay = session('s2', [assignment('a', 'Amal')], '2026-12-05');
    expect(
      splitCoaches({ session: onLastDay, leavesByCoach: leaves, timezone: 'Asia/Dubai' })
        .unavailable,
    ).toHaveLength(1);
  });

  it('uses the FACILITY day: 22:00 UTC is already the next day in Dubai', () => {
    const late = {
      ...session('s1', [assignment('a', 'Amal')]),
      startAt: new Date('2026-12-01T22:00:00Z'),
    };
    const out = splitCoaches({
      session: late,
      leavesByCoach: byCoach([leave('a', '2026-12-02', '2026-12-02')]),
      timezone: 'Asia/Dubai',
    });
    expect(out.unavailable).toHaveLength(1);
  });
});

describe('toCoverageEntry', () => {
  const run = (s, leaves, onlyCoachId) =>
    toCoverageEntry({
      session: s,
      leavesByCoach: byCoach(leaves),
      timezone: 'Asia/Dubai',
      onlyCoachId,
    });

  it('COVERED when at least one assigned coach is not on leave, with the covering coaches', () => {
    const entry = run(session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]), [
      leave('a', DAY1, DAY1),
    ]);
    expect(entry).toMatchObject({
      sessionId: 's1',
      classId: 'class-s1',
      title: 'Class s1',
      startAt: '2026-12-01T06:00:00.000Z',
      endAt: '2026-12-01T07:00:00.000Z',
      coverage: 'COVERED',
      coveringCoaches: [{ coachId: 'b', fullName: 'Basma' }],
    });
  });

  it('UNCOVERED when the only coach is on leave, or every assigned coach is', () => {
    const only = run(session('s1', [assignment('a', 'Amal')]), [leave('a', DAY1, DAY1)]);
    expect(only).toMatchObject({ coverage: 'UNCOVERED', coveringCoaches: [] });
    const both = run(session('s2', [assignment('a', 'Amal'), assignment('b', 'Basma')]), [
      leave('a', DAY1, DAY1),
      leave('b', DAY1, DAY1),
    ]);
    expect(both.coverage).toBe('UNCOVERED');
    expect(both.unavailableCoaches.map((c) => c.coachId)).toEqual(['a', 'b']);
  });

  it('a second coach who is on leave on ANOTHER day still covers', () => {
    const entry = run(session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]), [
      leave('a', DAY1, DAY1),
      leave('b', '2026-12-09', '2026-12-10'),
    ]);
    expect(entry.coverage).toBe('COVERED');
  });

  it('null when nobody assigned is on leave that day', () => {
    expect(
      run(session('s1', [assignment('a', 'Amal')]), [leave('a', '2026-12-03', '2026-12-04')]),
    ).toBeNull();
  });

  it('onlyCoachId keeps just the sessions where that coach is the one on leave', () => {
    const s = session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]);
    const leaves = [leave('a', DAY1, DAY1)];
    expect(run(s, leaves, 'a')).not.toBeNull();
    expect(run(s, leaves, 'b')).toBeNull();
  });
});

describe('listSessionCoverage', () => {
  it('loads leave once, then the sessions of the coaches on leave once; returns the entries', async () => {
    repo.findLeaveInRange.mockResolvedValue([leave('a', DAY1, DAY1)]);
    repo.findSessionsWithCoaches.mockResolvedValue([
      session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]),
      session('s2', [assignment('a', 'Amal')]),
      session('s3', [assignment('a', 'Amal')], '2026-12-04'), // a is on leave only on DAY1
    ]);
    const out = await listSessionCoverage({ caller: admin, query });
    expect(repo.findLeaveInRange).toHaveBeenCalledTimes(1);
    expect(repo.findLeaveInRange).toHaveBeenCalledWith({ fromDate: DAY1, toDate: '2026-12-07' });
    expect(repo.findSessionsWithCoaches).toHaveBeenCalledTimes(1);
    expect(repo.findSessionsWithCoaches).toHaveBeenCalledWith({
      coachIds: ['a'],
      from: new Date('2026-11-30T20:00:00.000Z'),
      to: new Date('2026-12-07T20:00:00.000Z'),
      classId: undefined,
    });
    expect(out.data.map((e) => [e.sessionId, e.coverage])).toEqual([
      ['s1', 'COVERED'],
      ['s2', 'UNCOVERED'],
    ]);
    expect(out.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('no leave in the range: no session query at all', async () => {
    const out = await listSessionCoverage({ caller: admin, query });
    expect(out.data).toEqual([]);
    expect(out.pagination.total).toBe(0);
    expect(repo.findSessionsWithCoaches).not.toHaveBeenCalled();
  });

  it('pages in memory and reports the filtered total', async () => {
    repo.findLeaveInRange.mockResolvedValue([leave('a', DAY1, DAY1)]);
    repo.findSessionsWithCoaches.mockResolvedValue(
      ['s1', 's2', 's3'].map((id) => session(id, [assignment('a', 'Amal')])),
    );
    const out = await listSessionCoverage({
      caller: admin,
      query: { ...query, page: 2, limit: 2 },
    });
    expect(out.data.map((e) => e.sessionId)).toEqual(['s3']);
    expect(out.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('a manager coachId filter limits the loaded coaches and the entries', async () => {
    repo.findLeaveInRange.mockResolvedValue([leave('a', DAY1, DAY1), leave('b', DAY1, DAY1)]);
    repo.findSessionsWithCoaches.mockResolvedValue([
      session('s1', [assignment('a', 'Amal'), assignment('b', 'Basma')]),
    ]);
    await listSessionCoverage({ caller: admin, query: { ...query, coachId: 'a' } });
    expect(repo.findSessionsWithCoaches).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['a'] }),
    );
  });

  it('a coach is limited to sessions where they are on leave; another coachId and a missing profile are 403', async () => {
    const coachCaller = { id: 'coach-user', role: Role.COACH };
    findCoachByUserId.mockResolvedValue({ id: 'a' });
    repo.findLeaveInRange.mockResolvedValue([leave('a', DAY1, DAY1), leave('b', DAY1, DAY1)]);
    repo.findSessionsWithCoaches.mockResolvedValue([session('s1', [assignment('a', 'Amal')])]);
    const out = await listSessionCoverage({ caller: coachCaller, query });
    expect(repo.findSessionsWithCoaches).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['a'] }),
    );
    expect(out.data).toHaveLength(1);

    await expect(
      listSessionCoverage({ caller: coachCaller, query: { ...query, coachId: 'b' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    findCoachByUserId.mockResolvedValue(null);
    await expect(listSessionCoverage({ caller: coachCaller, query })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('a member is 403', async () => {
    await expect(
      listSessionCoverage({ caller: { id: 'm', role: Role.MEMBER }, query }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
