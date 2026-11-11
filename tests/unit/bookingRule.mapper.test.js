const { toRuleResponse, toGroupedResponse } = require('../../src/repositories/bookingRule.mapper');
const {
  BookingRuleCategory,
  BOOKING_RULE_CATEGORY_LABELS,
} = require('../../src/constants/bookingRule');

const now = new Date('2026-11-10T08:00:00.000Z');
const row = (overrides) => ({
  id: 'id-1',
  ruleKey: 'BOOKING_WINDOW_OPENS',
  category: 'BOOKING_WINDOW',
  name: 'Booking opens before class',
  value: 504,
  unit: 'HOURS',
  enabled: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('toRuleResponse', () => {
  it('returns the public shape with lowercase category and unit', () => {
    expect(toRuleResponse(row())).toEqual({
      id: 'id-1',
      ruleKey: 'BOOKING_WINDOW_OPENS',
      category: 'booking_window',
      name: 'Booking opens before class',
      value: 504,
      unit: 'hours',
      enabled: true,
      updatedAt: now,
    });
  });

  it('keeps value and unit null for a flag rule', () => {
    const result = toRuleResponse(
      row({ ruleKey: 'CLASSPASS_ACCEPT', category: 'CLASSPASS', value: null, unit: null }),
    );
    expect(result).toMatchObject({ category: 'classpass', value: null, unit: null });
  });

  it('does not leak createdAt', () => {
    expect(toRuleResponse(row())).not.toHaveProperty('createdAt');
  });
});

describe('toGroupedResponse', () => {
  it('returns all 8 categories in order with their labels, even with no rules', () => {
    const { categories } = toGroupedResponse([]);
    expect(categories.map((c) => c.category)).toEqual(Object.values(BookingRuleCategory));
    categories.forEach((c) => {
      expect(c.label).toBe(BOOKING_RULE_CATEGORY_LABELS[c.category]);
      expect(c.rules).toEqual([]);
    });
  });

  it('groups rules by category and keeps catalogue order inside a group', () => {
    const rules = [
      row({ id: 'b', ruleKey: 'BOOKING_WINDOW_CLOSES' }),
      row({ id: 'c', ruleKey: 'LATE_FEE', category: 'CANCELLATIONS', value: 10, unit: 'PERCENT' }),
      row({ id: 'a', ruleKey: 'BOOKING_WINDOW_OPENS' }),
    ];
    const { categories } = toGroupedResponse(rules);
    expect(categories[0].rules.map((r) => r.id)).toEqual(['a', 'b']);
    expect(categories[1].rules.map((r) => r.id)).toEqual(['c']);
    expect(categories[2].rules).toEqual([]);
  });

  it('does not change the input array', () => {
    const rules = [
      row({ ruleKey: 'BOOKING_WINDOW_CLOSES' }),
      row({ ruleKey: 'BOOKING_WINDOW_OPENS' }),
    ];
    const copy = [...rules];
    toGroupedResponse(rules);
    expect(rules).toEqual(copy);
  });
});
