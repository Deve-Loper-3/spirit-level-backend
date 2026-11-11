const {
  eligibleCoachesQuerySchema: schema,
} = require('../../src/validators/coachEligibility.validation');
const { Messages } = require('../../src/constants/messages');

const ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const START = '2026-12-01T06:00:00Z';
const issues = (result) => result.error.issues.map((i) => [i.path.join('.'), i.message]);

describe('eligible coaches query', () => {
  it('startAt + endAt: both become Dates', () => {
    const data = schema.safeParse({ startAt: START, endAt: '2026-12-01T11:00:00+04:00' }).data;
    expect(data.startAt).toEqual(new Date('2026-12-01T06:00:00Z'));
    expect(data.endAt).toEqual(new Date('2026-12-01T07:00:00Z'));
  });

  it('startAt + appointmentTypeId, with both exclude ids', () => {
    const result = schema.safeParse({
      startAt: START,
      appointmentTypeId: ID,
      excludeSessionId: ID,
      excludeAppointmentId: ID,
    });
    expect(result.success).toBe(true);
  });

  it('requires startAt', () => {
    expect(issues(schema.safeParse({ endAt: START }))).toContainEqual([
      'startAt',
      Messages.ELIGIBLE_START_REQUIRED,
    ]);
  });

  it('requires endAt or appointmentTypeId, and not both', () => {
    expect(issues(schema.safeParse({ startAt: START }))).toEqual([
      ['endAt', Messages.ELIGIBLE_END_OR_TYPE_REQUIRED],
    ]);
    expect(
      issues(
        schema.safeParse({ startAt: START, endAt: '2026-12-01T07:00:00Z', appointmentTypeId: ID }),
      ),
    ).toEqual([['endAt', Messages.ELIGIBLE_END_AND_TYPE]]);
  });

  it('endAt must be after startAt', () => {
    expect(issues(schema.safeParse({ startAt: START, endAt: START }))).toEqual([
      ['endAt', Messages.ELIGIBLE_END_BEFORE_START],
    ]);
  });

  it.each([
    ['startAt without offset', { startAt: '2026-12-01T06:00:00', endAt: START }],
    ['bad appointmentTypeId', { startAt: START, appointmentTypeId: 'x' }],
    [
      'bad excludeSessionId',
      { startAt: START, endAt: '2026-12-01T07:00:00Z', excludeSessionId: 'x' },
    ],
    [
      'bad excludeAppointmentId',
      { startAt: START, endAt: '2026-12-01T07:00:00Z', excludeAppointmentId: 'x' },
    ],
  ])('rejects %s', (_label, query) => {
    expect(schema.safeParse(query).success).toBe(false);
  });

  it('rejects unknown parameters', () => {
    expect(
      issues(schema.safeParse({ startAt: START, endAt: '2026-12-01T07:00:00Z', page: '1' })),
    ).toContainEqual(['', Messages.ORDER_QUERY_UNKNOWN_FIELD]);
  });
});
