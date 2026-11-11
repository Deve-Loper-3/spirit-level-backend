jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  findActiveCoachesForPicker: jest.fn(),
}));
jest.mock('../../src/repositories/appointmentType.repository', () => ({
  findAppointmentTypeById: jest.fn(),
}));
jest.mock('../../src/services/coachSchedule.service', () => ({
  checkCoachesForInterval: jest.fn(),
}));

const repo = require('../../src/repositories/coachSchedule.repository');
const typeRepo = require('../../src/repositories/appointmentType.repository');
const { checkCoachesForInterval } = require('../../src/services/coachSchedule.service');
const { listEligibleCoaches } = require('../../src/services/coachEligibility.service');

const START = new Date('2026-12-01T06:00:00Z');
const END = new Date('2026-12-01T07:00:00Z');
const coaches = [
  { id: 'c1', user: { fullName: 'Amal' } },
  { id: 'c2', user: { fullName: 'Basma' } },
];

beforeEach(() => {
  jest.resetAllMocks();
  repo.findActiveCoachesForPicker.mockResolvedValue(coaches);
  checkCoachesForInterval.mockResolvedValue(new Map([['c1', null]]));
});

describe('listEligibleCoaches', () => {
  it('checks ALL active coaches in one call and maps eligible / conflict', async () => {
    checkCoachesForInterval.mockResolvedValue(
      new Map([
        ['c1', null],
        [
          'c2',
          {
            type: 'SESSION_OVERLAP',
            coachId: 'c2',
            message: 'busy',
            conflictingItem: { kind: 'SESSION', id: 's1', startAt: 'a', endAt: 'b' },
          },
        ],
      ]),
    );
    const out = await listEligibleCoaches({ query: { startAt: START, endAt: END } });
    expect(checkCoachesForInterval).toHaveBeenCalledTimes(1);
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ coachIds: ['c1', 'c2'], startAt: START, endAt: END }),
    );
    expect(out).toEqual([
      { coachId: 'c1', fullName: 'Amal', eligible: true, conflict: null },
      {
        coachId: 'c2',
        fullName: 'Basma',
        eligible: false,
        conflict: {
          type: 'SESSION_OVERLAP',
          message: 'busy',
          conflictingItem: { kind: 'SESSION', id: 's1', startAt: 'a', endAt: 'b' },
        },
      },
    ]);
  });

  it('with endAt there are no buffers and no type lookup', async () => {
    await listEligibleCoaches({ query: { startAt: START, endAt: END } });
    expect(typeRepo.findAppointmentTypeById).not.toHaveBeenCalled();
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ bufferBeforeMin: 0, bufferAfterMin: 0 }),
    );
  });

  it('with a type, endAt and the buffers come from the type', async () => {
    typeRepo.findAppointmentTypeById.mockResolvedValue({
      id: 't1',
      durationMin: 45,
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      isActive: true,
    });
    await listEligibleCoaches({ query: { startAt: START, appointmentTypeId: 't1' } });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({
        startAt: START,
        endAt: new Date('2026-12-01T06:45:00Z'),
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      }),
    );
  });

  it('passes the exclude ids through', async () => {
    await listEligibleCoaches({
      query: { startAt: START, endAt: END, excludeSessionId: 's1', excludeAppointmentId: 'a1' },
    });
    expect(checkCoachesForInterval).toHaveBeenCalledWith(
      expect.objectContaining({ excludeSessionId: 's1', excludeAppointmentId: 'a1' }),
    );
  });

  it('unknown type is 404, inactive type 409', async () => {
    typeRepo.findAppointmentTypeById.mockResolvedValue(null);
    await expect(
      listEligibleCoaches({ query: { startAt: START, appointmentTypeId: 't1' } }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_TYPE_NOT_FOUND' });
    typeRepo.findAppointmentTypeById.mockResolvedValue({ id: 't1', isActive: false });
    await expect(
      listEligibleCoaches({ query: { startAt: START, appointmentTypeId: 't1' } }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_TYPE_INACTIVE' });
  });

  it('no active coaches gives an empty list', async () => {
    repo.findActiveCoachesForPicker.mockResolvedValue([]);
    checkCoachesForInterval.mockResolvedValue(new Map());
    expect(await listEligibleCoaches({ query: { startAt: START, endAt: END } })).toEqual([]);
  });
});
