const {
  findValueProblem,
  bookingRuleIdParamSchema,
  createBookingRuleSchema,
  updateBookingRuleSchema,
} = require('../../src/validators/bookingRule.validation');
const { Messages } = require('../../src/constants/messages');

const issuesOf = (result) => result.error.issues.map((i) => ({ path: i.path, message: i.message }));

describe('findValueProblem (registry by value type)', () => {
  it.each([
    ['hours', 0],
    ['hours', 8760],
    ['days', 365],
    ['count', 0],
    ['count', 1000],
    ['percent', 1],
    ['percent', 100],
  ])('accepts %s value %s', (unit, value) => {
    expect(findValueProblem(value, unit)).toBeNull();
  });

  it.each([
    ['hours', -1],
    ['hours', 8761],
    ['days', 366],
    ['count', 1001],
  ])('rejects %s value %s as out of range', (unit, value) => {
    expect(findValueProblem(value, unit)).toMatch(/^Value must be between/);
  });

  it.each([
    ['hours', 1.5],
    ['hours', '5'],
    ['count', null],
    ['days', true],
    ['count', NaN],
  ])('rejects %s value %p as not a whole number', (unit, value) => {
    expect(findValueProblem(value, unit)).toBe(Messages.BOOKING_RULE_VALUE_NOT_WHOLE);
  });

  it.each([0, 101, 10.5, '10', null])('rejects percent value %p', (value) => {
    expect(findValueProblem(value, 'percent')).toBe(
      Messages.BOOKING_RULE_PERCENT_OUT_OF_RANGE(1, 100),
    );
  });

  it.each([5, 0, null, 'x'])('rejects any value %p for a flag rule (unit null)', (value) => {
    expect(findValueProblem(value, null)).toBe(Messages.BOOKING_RULE_FLAG_HAS_NO_VALUE);
  });
});

describe('createBookingRuleSchema', () => {
  it('accepts just a ruleKey', () => {
    const result = createBookingRuleSchema.safeParse({ ruleKey: 'LATE_FEE' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ruleKey: 'LATE_FEE' });
  });

  it('accepts a valid value and enabled', () => {
    const result = createBookingRuleSchema.safeParse({
      ruleKey: 'WAITLIST_MAX_PER_CLASS',
      value: 6,
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a flag rule with no value', () => {
    expect(
      createBookingRuleSchema.safeParse({ ruleKey: 'CLASSPASS_ACCEPT', enabled: true }).success,
    ).toBe(true);
  });

  it.each([{}, { ruleKey: 'NOT_A_RULE' }, { ruleKey: 5 }, { ruleKey: 'late_fee' }])(
    'rejects a missing or unknown ruleKey: %j',
    (body) => {
      const result = createBookingRuleSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(issuesOf(result)[0]).toEqual({
        path: ['ruleKey'],
        message: Messages.BOOKING_RULE_KEY_INVALID,
      });
    },
  );

  it('rejects a value outside the unit bounds', () => {
    const result = createBookingRuleSchema.safeParse({
      ruleKey: 'BOOKING_WINDOW_OPENS',
      value: 9000,
    });
    expect(issuesOf(result)).toEqual([
      { path: ['value'], message: Messages.BOOKING_RULE_VALUE_OUT_OF_RANGE(0, 8760, 'hours') },
    ]);
  });

  it('rejects a percent of 0 for the late fee', () => {
    const result = createBookingRuleSchema.safeParse({ ruleKey: 'LATE_FEE', value: 0 });
    expect(issuesOf(result)[0].path).toEqual(['value']);
  });

  it('rejects a value for a flag rule', () => {
    const result = createBookingRuleSchema.safeParse({ ruleKey: 'CLASSPASS_ACCEPT', value: 1 });
    expect(issuesOf(result)).toEqual([
      { path: ['value'], message: Messages.BOOKING_RULE_FLAG_HAS_NO_VALUE },
    ]);
  });

  it('rejects a non-boolean enabled', () => {
    const result = createBookingRuleSchema.safeParse({ ruleKey: 'LATE_FEE', enabled: 'yes' });
    expect(issuesOf(result)).toEqual([
      { path: ['enabled'], message: Messages.BOOKING_RULE_ENABLED_INVALID },
    ]);
  });

  it.each(['name', 'category', 'unit', 'id', 'extra'])('rejects the unknown field %s', (field) => {
    const result = createBookingRuleSchema.safeParse({ ruleKey: 'LATE_FEE', [field]: 'x' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(Messages.BOOKING_RULE_FIELD_UNKNOWN);
    expect(result.error.issues[0].keys).toEqual([field]);
  });
});

describe('updateBookingRuleSchema', () => {
  it.each([{ value: 5 }, { enabled: false }, { value: 5, enabled: true }])('accepts %j', (body) => {
    expect(updateBookingRuleSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = updateBookingRuleSchema.safeParse({});
    expect(issuesOf(result)).toEqual([{ path: [], message: Messages.BOOKING_RULE_UPDATE_EMPTY }]);
  });

  it.each(['name', 'category', 'unit', 'ruleKey', 'id'])('rejects the field %s', (field) => {
    const result = updateBookingRuleSchema.safeParse({ enabled: true, [field]: 'x' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].keys).toEqual([field]);
  });

  it('rejects a non-boolean enabled', () => {
    expect(updateBookingRuleSchema.safeParse({ enabled: 1 }).success).toBe(false);
  });
});

describe('bookingRuleIdParamSchema', () => {
  it('accepts a UUID', () => {
    const id = '3f2b8a4e-6f4e-4c61-9d0f-0c1f7f0a9b11';
    expect(bookingRuleIdParamSchema.safeParse({ id }).success).toBe(true);
  });

  it.each(['abc', '123', ''])('rejects %p', (id) => {
    const result = bookingRuleIdParamSchema.safeParse({ id });
    expect(issuesOf(result)[0].message).toBe(Messages.BOOKING_RULE_ID_INVALID);
  });
});
