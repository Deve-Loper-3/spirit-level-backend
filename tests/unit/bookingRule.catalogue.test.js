const {
  BOOKING_RULE_CATALOGUE,
  BookingRuleCategory,
  BookingRuleKind,
  BookingRuleKey,
  BookingRuleUnit,
  BookingRuleValueType,
  BOOKING_RULE_CATEGORY_LABELS,
  UNIT_BOUNDS,
  API_TO_DB_CATEGORY,
  DB_TO_API_CATEGORY,
  API_TO_DB_UNIT,
  DB_TO_API_UNIT,
  findCatalogueEntry,
} = require('../../src/constants/bookingRule');

// The approved rule table: [ruleKey, category, unit, defaultValue, defaultEnabled, kind].
const EXPECTED = [
  ['BOOKING_WINDOW_OPENS', 'booking_window', 'hours', 504, true, 'limit'],
  ['BOOKING_WINDOW_CLOSES', 'booking_window', 'hours', 1, true, 'limit'],
  ['TIMETABLE_VISIBLE_AHEAD', 'booking_window', 'days', 21, true, 'limit'],
  ['FREE_CANCEL_BEFORE_CLASS', 'cancellations', 'hours', 12, true, 'limit'],
  ['REFUNDED_CREDIT_EXPIRY', 'cancellations', 'days', 90, true, 'limit'],
  ['STRIKES_ENABLED', 'cancellations', null, null, true, 'feature'],
  ['STRIKES_BEFORE_SUSPENSION', 'cancellations', 'count', 3, true, 'limit'],
  ['LATE_FEE', 'cancellations', 'percent', 10, false, 'limit'],
  ['WAITLIST_ENABLED', 'waitlist_guests_capacity', null, null, true, 'feature'],
  ['WAITLIST_MAX_PER_CLASS', 'waitlist_guests_capacity', 'count', 4, true, 'limit'],
  ['WAITLIST_AUTO_BOOK', 'waitlist_guests_capacity', null, null, true, 'feature'],
  ['OVERBOOKING_ENABLED', 'waitlist_guests_capacity', null, null, true, 'feature'],
  ['MAX_GUESTS_PER_MEMBER', 'waitlist_guests_capacity', 'count', 1, true, 'limit'],
  ['MAX_CLASSES_PER_WEEK', 'booking_limit', 'count', 2, false, 'limit'],
  ['APPOINTMENT_OPENS', 'appointments', 'hours', 336, true, 'limit'],
  ['APPOINTMENT_CLOSES', 'appointments', 'hours', 12, true, 'limit'],
  ['APPOINTMENT_FREE_CANCEL', 'appointments', 'hours', 12, true, 'limit'],
  ['FACILITY_FREE_CANCEL', 'facilities', 'hours', 1, true, 'limit'],
  ['CLIENT_SELF_PAUSE', 'memberships_accounts', null, null, false, 'feature'],
  ['CREDIT_OVERDRAFT', 'memberships_accounts', null, null, false, 'feature'],
  ['CLASSPASS_ACCEPT', 'classpass', null, null, true, 'feature'],
];

describe('booking rule catalogue', () => {
  it('has exactly the 21 approved rules with the approved defaults', () => {
    const actual = BOOKING_RULE_CATALOGUE.map((r) => [
      r.ruleKey,
      r.category,
      r.unit,
      r.defaultValue,
      r.defaultEnabled,
      r.kind,
    ]);
    expect(actual).toEqual(EXPECTED);
  });

  it('has a unique ruleKey and name for every rule, and a BookingRuleKey for each', () => {
    const keys = BOOKING_RULE_CATALOGUE.map((r) => r.ruleKey);
    const names = BOOKING_RULE_CATALOGUE.map((r) => r.name);
    expect(new Set(keys).size).toBe(21);
    expect(new Set(names).size).toBe(21);
    expect(Object.values(BookingRuleKey).sort()).toEqual([...keys].sort());
  });

  it('uses all 8 categories and labels each one', () => {
    const used = new Set(BOOKING_RULE_CATALOGUE.map((r) => r.category));
    expect([...used].sort()).toEqual(Object.values(BookingRuleCategory).sort());
    Object.values(BookingRuleCategory).forEach((c) => {
      expect(typeof BOOKING_RULE_CATEGORY_LABELS[c]).toBe('string');
    });
  });

  it('derives the value type from the unit and keeps flags free of unit and value', () => {
    BOOKING_RULE_CATALOGUE.forEach((rule) => {
      if (rule.unit === null) {
        expect(rule.valueType).toBe(BookingRuleValueType.FLAG);
        expect(rule.defaultValue).toBeNull();
      } else if (rule.unit === BookingRuleUnit.PERCENT) {
        expect(rule.valueType).toBe(BookingRuleValueType.PERCENT);
      } else {
        expect(rule.valueType).toBe(BookingRuleValueType.INTEGER);
      }
    });
  });

  it('keeps every default value inside its unit bounds', () => {
    BOOKING_RULE_CATALOGUE.filter((r) => r.unit !== null).forEach((rule) => {
      const { min, max } = UNIT_BOUNDS[rule.unit];
      expect(Number.isInteger(rule.defaultValue)).toBe(true);
      expect(rule.defaultValue).toBeGreaterThanOrEqual(min);
      expect(rule.defaultValue).toBeLessThanOrEqual(max);
    });
  });

  it('uses the approved bounds', () => {
    expect(UNIT_BOUNDS).toEqual({
      hours: { min: 0, max: 8760 },
      days: { min: 0, max: 365 },
      count: { min: 0, max: 1000 },
      percent: { min: 1, max: 100 },
    });
  });

  it('marks exactly the 7 on/off rules as features', () => {
    const features = BOOKING_RULE_CATALOGUE.filter((r) => r.kind === BookingRuleKind.FEATURE);
    expect(features.map((r) => r.ruleKey)).toEqual([
      'STRIKES_ENABLED',
      'WAITLIST_ENABLED',
      'WAITLIST_AUTO_BOOK',
      'OVERBOOKING_ENABLED',
      'CLIENT_SELF_PAUSE',
      'CREDIT_OVERDRAFT',
      'CLASSPASS_ACCEPT',
    ]);
    features.forEach((r) => expect(r.unit).toBeNull());
  });

  it('maps categories and units between API and database values both ways', () => {
    Object.values(BookingRuleCategory).forEach((c) => {
      expect(API_TO_DB_CATEGORY[c]).toBe(c.toUpperCase());
      expect(DB_TO_API_CATEGORY[API_TO_DB_CATEGORY[c]]).toBe(c);
    });
    Object.values(BookingRuleUnit).forEach((u) => {
      expect(API_TO_DB_UNIT[u]).toBe(u.toUpperCase());
      expect(DB_TO_API_UNIT[API_TO_DB_UNIT[u]]).toBe(u);
    });
  });

  it('finds an entry by key and returns null for an unknown key', () => {
    expect(findCatalogueEntry('LATE_FEE').defaultValue).toBe(10);
    expect(findCatalogueEntry('NOT_A_RULE')).toBeNull();
  });

  it('is deeply frozen at the entry level', () => {
    expect(Object.isFrozen(BOOKING_RULE_CATALOGUE)).toBe(true);
    BOOKING_RULE_CATALOGUE.forEach((r) => expect(Object.isFrozen(r)).toBe(true));
  });
});
