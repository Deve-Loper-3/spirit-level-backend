const { openSlotsQuerySchema: schema } = require('../../src/validators/coachSlots.validation');
const { Messages } = require('../../src/constants/messages');
const { OPEN_SLOTS_MAX_DAYS } = require('../../src/constants/availability');

const ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const valid = { appointmentTypeId: ID, from: '2026-12-01', to: '2026-12-07' };
const issues = (result) => result.error.issues.map((i) => [i.path.join('.'), i.message]);

describe('open slots query', () => {
  it('accepts the required fields and the optional excludeAppointmentId', () => {
    expect(schema.safeParse(valid).data).toEqual(valid);
    expect(schema.safeParse({ ...valid, excludeAppointmentId: ID }).success).toBe(true);
  });

  it('a single day (from = to) is fine', () => {
    expect(schema.safeParse({ ...valid, to: valid.from }).success).toBe(true);
  });

  it('reports every missing field together', () => {
    expect(issues(schema.safeParse({}))).toEqual([
      ['appointmentTypeId', Messages.SLOTS_TYPE_REQUIRED],
      ['from', Messages.SLOTS_FROM_REQUIRED],
      ['to', Messages.SLOTS_TO_REQUIRED],
    ]);
  });

  it.each([
    ['bad type id', { appointmentTypeId: 'x' }, 'appointmentTypeId'],
    ['date with time', { from: '2026-12-01T00:00:00Z' }, 'from'],
    ['impossible date', { to: '2026-02-30' }, 'to'],
    ['bad excludeAppointmentId', { excludeAppointmentId: 'x' }, 'excludeAppointmentId'],
  ])('rejects %s', (_label, override, field) => {
    const result = schema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it('to before from is rejected', () => {
    expect(issues(schema.safeParse({ ...valid, from: '2026-12-07', to: '2026-12-01' }))).toEqual([
      ['to', Messages.SLOTS_RANGE_ORDER],
    ]);
  });

  it(`the range is limited to ${OPEN_SLOTS_MAX_DAYS} days (inclusive)`, () => {
    expect(schema.safeParse({ ...valid, from: '2026-12-01', to: '2026-12-31' }).success).toBe(true); // 31 days
    expect(issues(schema.safeParse({ ...valid, from: '2026-12-01', to: '2027-01-01' }))).toEqual([
      ['to', Messages.SLOTS_RANGE_TOO_LONG(OPEN_SLOTS_MAX_DAYS)],
    ]); // 32 days
  });

  it('rejects unknown parameters', () => {
    expect(issues(schema.safeParse({ ...valid, step: '30' }))).toContainEqual([
      '',
      Messages.ORDER_QUERY_UNKNOWN_FIELD,
    ]);
  });
});
