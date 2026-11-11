jest.mock('../../src/config/env', () => ({ FACILITY_TIMEZONE: 'Asia/Dubai' }));
jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  findWeekForCoach: jest.fn(),
  findLeaveForCoaches: jest.fn(),
  findSessionsForCoaches: jest.fn(),
  findAppointmentsForCoaches: jest.fn(),
}));
jest.mock('../../src/repositories/appointmentType.repository', () => ({
  findAppointmentTypeById: jest.fn(),
}));
jest.mock('../../src/repositories/coach.repository', () => ({ findCoachById: jest.fn() }));

const repo = require('../../src/repositories/coachSchedule.repository');
const typeRepo = require('../../src/repositories/appointmentType.repository');
const { findCoachById } = require('../../src/repositories/coach.repository');
const { getOpenSlots, eachDate } = require('../../src/services/coachSlots.service');
const { Role } = require('../../src/constants/roles');

const COACH_ID = 'coach-1';
const TYPE_ID = 'type-1';
const NOW = new Date('2026-11-01T00:00:00Z');
const admin = { id: 'admin', role: Role.ADMIN };
const ownCoach = { id: 'coach-user', role: Role.COACH };
const query = { appointmentTypeId: TYPE_ID, from: '2026-12-01', to: '2026-12-03' };

const coachRow = (overrides = {}) => ({
  id: COACH_ID,
  status: 'ACTIVE',
  user: { id: 'coach-user' },
  ...overrides,
});
const typeRow = (overrides = {}) => ({
  id: TYPE_ID,
  durationMin: 60,
  bufferBeforeMin: 5,
  bufferAfterMin: 10,
  isActive: true,
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  findCoachById.mockResolvedValue(coachRow());
  typeRepo.findAppointmentTypeById.mockResolvedValue(typeRow());
  repo.findWeekForCoach.mockResolvedValue([
    { dayOfWeek: 2, isAvailable: true, ranges: [{ start: 540, end: 660 }] },
  ]);
  repo.findLeaveForCoaches.mockResolvedValue([]);
  repo.findSessionsForCoaches.mockResolvedValue([]);
  repo.findAppointmentsForCoaches.mockResolvedValue([]);
});

describe('eachDate', () => {
  it('lists every day, inclusive, across a month end', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(eachDate('2026-12-01', '2026-12-01')).toEqual(['2026-12-01']);
  });
});

describe('getOpenSlots', () => {
  it('loads each source ONCE for the whole range and builds the documented response', async () => {
    const out = await getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW });
    for (const loader of [
      repo.findWeekForCoach,
      repo.findLeaveForCoaches,
      repo.findSessionsForCoaches,
      repo.findAppointmentsForCoaches,
    ]) {
      expect(loader).toHaveBeenCalledTimes(1);
    }
    expect(repo.findLeaveForCoaches).toHaveBeenCalledWith([COACH_ID], '2026-12-01', '2026-12-03');
    expect(repo.findSessionsForCoaches).toHaveBeenCalledWith({
      coachIds: [COACH_ID],
      startAt: new Date('2026-11-30T20:00:00.000Z'),
      endAt: new Date('2026-12-03T20:00:00.000Z'),
    });
    expect(repo.findAppointmentsForCoaches).toHaveBeenCalledWith({
      coachIds: [COACH_ID],
      startAt: new Date('2026-11-30T20:00:00.000Z'),
      endAt: new Date('2026-12-03T20:00:00.000Z'),
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      excludeAppointmentId: undefined,
    });
    expect(out).toEqual({
      coachId: COACH_ID,
      appointmentTypeId: TYPE_ID,
      timezone: 'Asia/Dubai',
      from: '2026-12-01',
      to: '2026-12-03',
      availabilityConfigured: true,
      days: [
        {
          date: '2026-12-01',
          slots: [
            // Tuesday 09:00-11:00 Dubai, buffers 5 / 10 around nothing: two 60-minute slots
            { startAt: '2026-12-01T05:00:00.000Z', endAt: '2026-12-01T06:00:00.000Z' },
            { startAt: '2026-12-01T06:00:00.000Z', endAt: '2026-12-01T07:00:00.000Z' },
          ],
        },
        { date: '2026-12-02', slots: [] },
        { date: '2026-12-03', slots: [] },
      ],
    });
  });

  it('passes excludeAppointmentId to the appointment loader', async () => {
    await getOpenSlots({
      caller: admin,
      coachId: COACH_ID,
      query: { ...query, excludeAppointmentId: 'a1' },
      now: NOW,
    });
    expect(repo.findAppointmentsForCoaches).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: 'a1' }),
    );
  });

  it('a coach with no saved hours: empty days and availabilityConfigured = false', async () => {
    repo.findWeekForCoach.mockResolvedValue([]);
    const out = await getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW });
    expect(out.availabilityConfigured).toBe(false);
    expect(out.days).toHaveLength(3);
    expect(out.days.every((d) => d.slots.length === 0)).toBe(true);
  });

  it('a week saved with every day off is configured but has no slots', async () => {
    repo.findWeekForCoach.mockResolvedValue([{ dayOfWeek: 2, isAvailable: false, ranges: [] }]);
    const out = await getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW });
    expect(out.availabilityConfigured).toBe(true);
    expect(out.days.every((d) => d.slots.length === 0)).toBe(true);
  });

  it('a coach reads their own slots; another coach and a member are 403', async () => {
    await expect(
      getOpenSlots({ caller: ownCoach, coachId: COACH_ID, query, now: NOW }),
    ).resolves.toBeDefined();
    await expect(
      getOpenSlots({
        caller: { id: 'other', role: Role.COACH },
        coachId: COACH_ID,
        query,
        now: NOW,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getOpenSlots({ caller: { id: 'm', role: Role.MEMBER }, coachId: COACH_ID, query, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findWeekForCoach).toHaveBeenCalledTimes(1); // only the allowed call loaded data
  });

  it('404 for an unknown coach or type, 409 for an inactive coach or type; nothing is loaded', async () => {
    findCoachById.mockResolvedValue(null);
    await expect(
      getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'COACH_NOT_FOUND' });

    findCoachById.mockResolvedValue(coachRow());
    typeRepo.findAppointmentTypeById.mockResolvedValue(null);
    await expect(
      getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_TYPE_NOT_FOUND' });

    typeRepo.findAppointmentTypeById.mockResolvedValue(typeRow({ isActive: false }));
    await expect(
      getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_TYPE_INACTIVE' });

    typeRepo.findAppointmentTypeById.mockResolvedValue(typeRow());
    findCoachById.mockResolvedValue(coachRow({ status: 'INACTIVE' }));
    await expect(
      getOpenSlots({ caller: admin, coachId: COACH_ID, query, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'COACH_INACTIVE' });
    expect(repo.findWeekForCoach).not.toHaveBeenCalled();
  });
});
