jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  findCoachStatus: jest.fn(),
  lockCoachSchedule: jest.fn(),
}));

const { findCoachStatus } = require('../../src/repositories/coachSchedule.repository');
const { assertIntervalAssignable } = require('../../src/services/coachSchedule.service');

const params = {
  coachId: 'coach-1',
  startAt: new Date('2026-12-01T06:00:00Z'),
  endAt: new Date('2026-12-01T07:00:00Z'),
  bufferBeforeMin: 5,
  bufferAfterMin: 10,
};
const tx = { tx: true };

beforeEach(() => jest.resetAllMocks());

describe('assertIntervalAssignable (S6 pass-through seam)', () => {
  it('resolves for an active coach and reads through the given client', async () => {
    findCoachStatus.mockResolvedValue({ id: 'coach-1', status: 'ACTIVE' });
    await expect(assertIntervalAssignable(params, tx)).resolves.toBeUndefined();
    expect(findCoachStatus).toHaveBeenCalledWith('coach-1', tx);
  });

  it('throws 404 COACH_NOT_FOUND for an unknown coach', async () => {
    findCoachStatus.mockResolvedValue(null);
    await expect(assertIntervalAssignable(params, tx)).rejects.toMatchObject({
      statusCode: 404,
      code: 'COACH_NOT_FOUND',
    });
  });

  it('throws 409 COACH_INACTIVE for an inactive coach', async () => {
    findCoachStatus.mockResolvedValue({ id: 'coach-1', status: 'INACTIVE' });
    await expect(assertIntervalAssignable(params, tx)).rejects.toMatchObject({
      statusCode: 409,
      code: 'COACH_INACTIVE',
    });
  });

  it('accepts excludeAppointmentId without using it yet', async () => {
    findCoachStatus.mockResolvedValue({ id: 'coach-1', status: 'ACTIVE' });
    await expect(
      assertIntervalAssignable({ ...params, excludeAppointmentId: 'a1' }, tx),
    ).resolves.toBeUndefined();
  });
});
