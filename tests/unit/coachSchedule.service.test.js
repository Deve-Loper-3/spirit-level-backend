jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  lockCoachSchedule: jest.fn(),
  findCoachStatus: jest.fn(),
  findDaysForCoaches: jest.fn(),
  findLeaveForCoaches: jest.fn(),
  findSessionsForCoaches: jest.fn(),
  findAppointmentsForCoaches: jest.fn(),
  findActiveCoachesForPicker: jest.fn(),
}));

const repo = require('../../src/repositories/coachSchedule.repository');
const {
  checkCoachesForInterval,
  assertIntervalAssignable,
} = require('../../src/services/coachSchedule.service');

const tx = { tx: true };
const at = (hhmm, date = '2026-12-01') => new Date(`${date}T${hhmm}:00+04:00`); // Tuesday
const interval = { startAt: at('10:00'), endAt: at('11:00') };
const open = (coachId) => ({
  coachId,
  isAvailable: true,
  ranges: [{ start: 0, end: 23 * 60 + 59 }],
});

beforeEach(() => {
  jest.resetAllMocks();
  repo.findCoachStatus.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
  repo.findDaysForCoaches.mockResolvedValue([]);
  repo.findLeaveForCoaches.mockResolvedValue([]);
  repo.findSessionsForCoaches.mockResolvedValue([]);
  repo.findAppointmentsForCoaches.mockResolvedValue([]);
});

describe('checkCoachesForInterval', () => {
  it('queries each source ONCE for all coaches, however many there are', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
    await checkCoachesForInterval({ coachIds: [...ids, 'c1'], ...interval }, tx);
    for (const loader of [
      repo.findDaysForCoaches,
      repo.findLeaveForCoaches,
      repo.findSessionsForCoaches,
      repo.findAppointmentsForCoaches,
    ]) {
      expect(loader).toHaveBeenCalledTimes(1);
    }
    expect(repo.findDaysForCoaches).toHaveBeenCalledWith(ids, 2, tx); // deduped, Tuesday = 2
    expect(repo.findLeaveForCoaches).toHaveBeenCalledWith(ids, '2026-12-01', '2026-12-01', tx);
    expect(repo.findSessionsForCoaches).toHaveBeenCalledWith(
      { coachIds: ids, ...interval, excludeSessionId: undefined },
      tx,
    );
  });

  it('passes the buffers and both exclude ids to the loaders', async () => {
    await checkCoachesForInterval(
      {
        coachIds: ['c1'],
        ...interval,
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
        excludeAppointmentId: 'a1',
        excludeSessionId: 's1',
      },
      tx,
    );
    expect(repo.findAppointmentsForCoaches).toHaveBeenCalledWith(
      expect.objectContaining({
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
        excludeAppointmentId: 'a1',
      }),
      tx,
    );
    expect(repo.findSessionsForCoaches).toHaveBeenCalledWith(
      expect.objectContaining({ excludeSessionId: 's1' }),
      tx,
    );
  });

  it('asks for leave over every facility date the interval touches', async () => {
    await checkCoachesForInterval(
      { coachIds: ['c1'], startAt: at('23:00'), endAt: at('01:00', '2026-12-02') },
      tx,
    );
    expect(repo.findLeaveForCoaches).toHaveBeenCalledWith(['c1'], '2026-12-01', '2026-12-02', tx);
  });

  it('returns a result per coach: null when free, the first conflict otherwise', async () => {
    repo.findDaysForCoaches.mockResolvedValue([open('c1'), open('c3')]); // c2 has no row
    repo.findLeaveForCoaches.mockResolvedValue([
      { id: 'l1', coachId: 'c3', startDate: '2026-12-01', endDate: '2026-12-01' },
    ]);
    const result = await checkCoachesForInterval({ coachIds: ['c1', 'c2', 'c3'], ...interval });
    expect(result.get('c1')).toBeNull();
    expect(result.get('c2')).toMatchObject({ type: 'AVAILABILITY_NOT_SET', coachId: 'c2' });
    expect(result.get('c3')).toMatchObject({ type: 'COACH_UNAVAILABLE', coachId: 'c3' });
  });

  it('a session shared by two coaches counts for both of them', async () => {
    repo.findDaysForCoaches.mockResolvedValue([open('c1'), open('c2'), open('c3')]);
    repo.findSessionsForCoaches.mockResolvedValue([
      { id: 's1', startAt: at('10:30'), endAt: at('11:30'), coachIds: ['c1', 'c2'] },
    ]);
    const result = await checkCoachesForInterval({ coachIds: ['c1', 'c2', 'c3'], ...interval });
    expect(result.get('c1').type).toBe('SESSION_OVERLAP');
    expect(result.get('c2').type).toBe('SESSION_OVERLAP');
    expect(result.get('c3')).toBeNull();
  });

  it("only uses each coach's own appointments", async () => {
    repo.findDaysForCoaches.mockResolvedValue([open('c1'), open('c2')]);
    repo.findAppointmentsForCoaches.mockResolvedValue([
      {
        id: 'a1',
        coachId: 'c2',
        startAt: at('10:30'),
        endAt: at('11:30'),
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
      },
    ]);
    const result = await checkCoachesForInterval({ coachIds: ['c1', 'c2'], ...interval });
    expect(result.get('c1')).toBeNull();
    expect(result.get('c2').type).toBe('APPOINTMENT_OVERLAP');
  });

  it('no coaches: no queries, empty result', async () => {
    const result = await checkCoachesForInterval({ coachIds: [], ...interval });
    expect(result.size).toBe(0);
    expect(repo.findDaysForCoaches).not.toHaveBeenCalled();
  });

  it('rejects an empty or inverted interval (a programming error)', async () => {
    await expect(
      checkCoachesForInterval({ coachIds: ['c1'], startAt: at('11:00'), endAt: at('10:00') }),
    ).rejects.toThrow(RangeError);
  });
});

describe('assertIntervalAssignable', () => {
  it('404 for an unknown coach and 409 COACH_INACTIVE for an inactive one, before any rule', async () => {
    repo.findCoachStatus.mockResolvedValue(null);
    await expect(
      assertIntervalAssignable({ coachId: 'c1', ...interval }, tx),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'COACH_NOT_FOUND',
    });
    repo.findCoachStatus.mockResolvedValue({ id: 'c1', status: 'INACTIVE' });
    await expect(
      assertIntervalAssignable({ coachId: 'c1', ...interval }, tx),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'COACH_INACTIVE',
    });
    expect(repo.findDaysForCoaches).not.toHaveBeenCalled();
  });

  it('resolves for a free coach and reads through the given client', async () => {
    repo.findDaysForCoaches.mockResolvedValue([open('c1')]);
    await expect(
      assertIntervalAssignable(
        { coachId: 'c1', ...interval, bufferBeforeMin: 0, bufferAfterMin: 0 },
        tx,
      ),
    ).resolves.toBeUndefined();
    expect(repo.findCoachStatus).toHaveBeenCalledWith('c1', tx);
    expect(repo.findDaysForCoaches).toHaveBeenCalledWith(['c1'], 2, tx);
  });

  it('throws 409 COACH_CONFLICT with details.conflicts[] in the agreed shape', async () => {
    repo.findDaysForCoaches.mockResolvedValue([open('c1')]);
    repo.findSessionsForCoaches.mockResolvedValue([
      { id: 's1', startAt: at('10:30'), endAt: at('11:30'), coachIds: ['c1'] },
    ]);
    const error = await assertIntervalAssignable({ coachId: 'c1', ...interval }, tx).catch(
      (e) => e,
    );
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'COACH_CONFLICT',
      message: 'The coach is assigned to another class session at that time',
      details: {
        conflicts: [
          {
            type: 'SESSION_OVERLAP',
            coachId: 'c1',
            message: 'The coach is assigned to another class session at that time',
            conflictingItem: {
              kind: 'SESSION',
              id: 's1',
              startAt: '2026-12-01T06:30:00.000Z',
              endAt: '2026-12-01T07:30:00.000Z',
            },
          },
        ],
      },
    });
  });

  it('an availability conflict has an explicit null conflictingItem', async () => {
    const error = await assertIntervalAssignable({ coachId: 'c1', ...interval }, tx).catch(
      (e) => e,
    );
    expect(error.details.conflicts[0]).toMatchObject({
      type: 'AVAILABILITY_NOT_SET',
      conflictingItem: null,
    });
  });
});
