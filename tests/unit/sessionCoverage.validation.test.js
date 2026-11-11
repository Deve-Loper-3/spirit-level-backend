const {
  sessionCoverageQuerySchema: schema,
} = require('../../src/validators/sessionCoverage.validation');
const { Messages } = require('../../src/constants/messages');
const { COVERAGE_MAX_DAYS } = require('../../src/constants/availability');

const ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const valid = { from: '2026-12-01', to: '2026-12-07' };
const issues = (result) => result.error.issues.map((i) => [i.path.join('.'), i.message]);

describe('session coverage query', () => {
  it('accepts from + to with the paging defaults, and the optional filters', () => {
    expect(schema.safeParse(valid).data).toEqual({ ...valid, page: 1, limit: 20 });
    expect(
      schema.safeParse({ ...valid, coachId: ID, classId: ID, page: '2', limit: '5' }).data,
    ).toMatchObject({
      coachId: ID,
      classId: ID,
      page: 2,
      limit: 5,
    });
  });

  it('reports a missing from / to', () => {
    expect(issues(schema.safeParse({}))).toEqual([
      ['from', Messages.COVERAGE_FROM_REQUIRED],
      ['to', Messages.COVERAGE_TO_REQUIRED],
    ]);
  });

  it.each([
    ['date with time', { from: '2026-12-01T00:00:00Z' }, 'from'],
    ['impossible date', { to: '2026-02-30' }, 'to'],
    ['bad coachId', { coachId: 'x' }, 'coachId'],
    ['bad classId', { classId: 'x' }, 'classId'],
    ['page 0', { page: '0' }, 'page'],
  ])('rejects %s', (_label, override, field) => {
    const result = schema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it('to before from, and a range over the limit, are rejected on `to`', () => {
    expect(issues(schema.safeParse({ from: '2026-12-07', to: '2026-12-01' }))).toEqual([
      ['to', Messages.COVERAGE_RANGE_ORDER],
    ]);
    expect(schema.safeParse({ from: '2026-12-01', to: '2026-12-31' }).success).toBe(true); // 31 days
    expect(issues(schema.safeParse({ from: '2026-12-01', to: '2027-01-01' }))).toEqual([
      ['to', Messages.COVERAGE_RANGE_TOO_LONG(COVERAGE_MAX_DAYS)],
    ]); // 32 days
  });

  it('rejects unknown parameters', () => {
    expect(issues(schema.safeParse({ ...valid, state: 'open' }))).toContainEqual([
      '',
      Messages.ORDER_QUERY_UNKNOWN_FIELD,
    ]);
  });
});
