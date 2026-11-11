// Studio-wide booking rules (SLAPP-104 / BE-SET-1). The catalogue below is the single source of
// truth: the seed, the validators and the enforcement code all read from it. API values are
// lowercase, database enum values are uppercase (same convention as the cafe constants).

const BookingRuleCategory = Object.freeze({
  BOOKING_WINDOW: 'booking_window',
  CANCELLATIONS: 'cancellations',
  WAITLIST_GUESTS_CAPACITY: 'waitlist_guests_capacity',
  BOOKING_LIMIT: 'booking_limit',
  APPOINTMENTS: 'appointments',
  FACILITIES: 'facilities',
  MEMBERSHIPS_ACCOUNTS: 'memberships_accounts',
  CLASSPASS: 'classpass',
});

const BookingRuleUnit = Object.freeze({
  HOURS: 'hours',
  DAYS: 'days',
  COUNT: 'count',
  PERCENT: 'percent',
});

// How a rule's value is validated: whole number in the unit's bounds, whole percent, or no value.
const BookingRuleValueType = Object.freeze({
  INTEGER: 'integer',
  PERCENT: 'percent',
  FLAG: 'flag',
});

// LIMIT: disabled (or deleted) means no restriction.
// FEATURE: disabled (or deleted) means the feature is off.
const BookingRuleKind = Object.freeze({
  LIMIT: 'limit',
  FEATURE: 'feature',
});

const BookingRuleKey = Object.freeze({
  BOOKING_WINDOW_OPENS: 'BOOKING_WINDOW_OPENS',
  BOOKING_WINDOW_CLOSES: 'BOOKING_WINDOW_CLOSES',
  TIMETABLE_VISIBLE_AHEAD: 'TIMETABLE_VISIBLE_AHEAD',
  FREE_CANCEL_BEFORE_CLASS: 'FREE_CANCEL_BEFORE_CLASS',
  REFUNDED_CREDIT_EXPIRY: 'REFUNDED_CREDIT_EXPIRY',
  STRIKES_ENABLED: 'STRIKES_ENABLED',
  STRIKES_BEFORE_SUSPENSION: 'STRIKES_BEFORE_SUSPENSION',
  LATE_FEE: 'LATE_FEE',
  WAITLIST_ENABLED: 'WAITLIST_ENABLED',
  WAITLIST_MAX_PER_CLASS: 'WAITLIST_MAX_PER_CLASS',
  WAITLIST_AUTO_BOOK: 'WAITLIST_AUTO_BOOK',
  OVERBOOKING_ENABLED: 'OVERBOOKING_ENABLED',
  MAX_GUESTS_PER_MEMBER: 'MAX_GUESTS_PER_MEMBER',
  MAX_CLASSES_PER_WEEK: 'MAX_CLASSES_PER_WEEK',
  APPOINTMENT_OPENS: 'APPOINTMENT_OPENS',
  APPOINTMENT_CLOSES: 'APPOINTMENT_CLOSES',
  APPOINTMENT_FREE_CANCEL: 'APPOINTMENT_FREE_CANCEL',
  FACILITY_FREE_CANCEL: 'FACILITY_FREE_CANCEL',
  CLIENT_SELF_PAUSE: 'CLIENT_SELF_PAUSE',
  CREDIT_OVERDRAFT: 'CREDIT_OVERDRAFT',
  CLASSPASS_ACCEPT: 'CLASSPASS_ACCEPT',
});

const BOOKING_RULE_CATEGORY_LABELS = Object.freeze({
  [BookingRuleCategory.BOOKING_WINDOW]: 'Booking Window',
  [BookingRuleCategory.CANCELLATIONS]: 'Cancellations & No-shows',
  [BookingRuleCategory.WAITLIST_GUESTS_CAPACITY]: 'Waitlist, Guests & Capacity',
  [BookingRuleCategory.BOOKING_LIMIT]: 'Booking Limit',
  [BookingRuleCategory.APPOINTMENTS]: 'Appointments (PT)',
  [BookingRuleCategory.FACILITIES]: 'Facilities',
  [BookingRuleCategory.MEMBERSHIPS_ACCOUNTS]: 'Memberships & Accounts',
  [BookingRuleCategory.CLASSPASS]: 'ClassPass',
});

// Allowed whole-number range per unit (inclusive). Mirrored by the CHECK constraint in the
// 20261110120000_add_booking_rules migration.
const UNIT_BOUNDS = Object.freeze({
  [BookingRuleUnit.HOURS]: Object.freeze({ min: 0, max: 8760 }),
  [BookingRuleUnit.DAYS]: Object.freeze({ min: 0, max: 365 }),
  [BookingRuleUnit.COUNT]: Object.freeze({ min: 0, max: 1000 }),
  [BookingRuleUnit.PERCENT]: Object.freeze({ min: 1, max: 100 }),
});

const toUpperMap = (values) =>
  Object.freeze(Object.fromEntries(Object.values(values).map((v) => [v, v.toUpperCase()])));
const toLowerMap = (values) =>
  Object.freeze(Object.fromEntries(Object.values(values).map((v) => [v.toUpperCase(), v])));

const API_TO_DB_CATEGORY = toUpperMap(BookingRuleCategory);
const DB_TO_API_CATEGORY = toLowerMap(BookingRuleCategory);
const API_TO_DB_UNIT = toUpperMap(BookingRuleUnit);
const DB_TO_API_UNIT = toLowerMap(BookingRuleUnit);

const valueTypeOf = (unit) => {
  if (unit === null) return BookingRuleValueType.FLAG;
  return unit === BookingRuleUnit.PERCENT
    ? BookingRuleValueType.PERCENT
    : BookingRuleValueType.INTEGER;
};

// A flag rule has no unit and no value (pass unit = null, defaultValue = null).
const defineRule = ({
  ruleKey,
  category,
  name,
  kind = BookingRuleKind.LIMIT,
  unit = null,
  defaultValue = null,
  defaultEnabled = true,
}) =>
  Object.freeze({
    ruleKey,
    category,
    name,
    kind,
    unit,
    valueType: valueTypeOf(unit),
    defaultValue,
    defaultEnabled,
  });

const { BOOKING_WINDOW, CANCELLATIONS, WAITLIST_GUESTS_CAPACITY, BOOKING_LIMIT } =
  BookingRuleCategory;
const { APPOINTMENTS, FACILITIES, MEMBERSHIPS_ACCOUNTS, CLASSPASS } = BookingRuleCategory;
const { HOURS, DAYS, COUNT, PERCENT } = BookingRuleUnit;
const { FEATURE } = BookingRuleKind;

const BOOKING_RULE_CATALOGUE = Object.freeze([
  defineRule({
    ruleKey: BookingRuleKey.BOOKING_WINDOW_OPENS,
    category: BOOKING_WINDOW,
    name: 'Booking opens before class',
    unit: HOURS,
    defaultValue: 504,
  }),
  defineRule({
    ruleKey: BookingRuleKey.BOOKING_WINDOW_CLOSES,
    category: BOOKING_WINDOW,
    name: 'Booking closes before class',
    unit: HOURS,
    defaultValue: 1,
  }),
  defineRule({
    ruleKey: BookingRuleKey.TIMETABLE_VISIBLE_AHEAD,
    category: BOOKING_WINDOW,
    name: 'Timetable visible ahead',
    unit: DAYS,
    defaultValue: 21,
  }),
  defineRule({
    ruleKey: BookingRuleKey.FREE_CANCEL_BEFORE_CLASS,
    category: CANCELLATIONS,
    name: 'Free cancellation before class',
    unit: HOURS,
    defaultValue: 12,
  }),
  defineRule({
    ruleKey: BookingRuleKey.REFUNDED_CREDIT_EXPIRY,
    category: CANCELLATIONS,
    name: 'Refunded credit expires after',
    unit: DAYS,
    defaultValue: 90,
  }),
  defineRule({
    ruleKey: BookingRuleKey.STRIKES_ENABLED,
    category: CANCELLATIONS,
    name: 'Strikes enabled',
    kind: FEATURE,
  }),
  defineRule({
    ruleKey: BookingRuleKey.STRIKES_BEFORE_SUSPENSION,
    category: CANCELLATIONS,
    name: 'Strikes before suspension',
    unit: COUNT,
    defaultValue: 3,
  }),
  defineRule({
    ruleKey: BookingRuleKey.LATE_FEE,
    category: CANCELLATIONS,
    name: 'Late cancellation fee (% of class fee)',
    unit: PERCENT,
    defaultValue: 10,
    defaultEnabled: false,
  }),
  defineRule({
    ruleKey: BookingRuleKey.WAITLIST_ENABLED,
    category: WAITLIST_GUESTS_CAPACITY,
    name: 'Waitlist enabled',
    kind: FEATURE,
  }),
  defineRule({
    ruleKey: BookingRuleKey.WAITLIST_MAX_PER_CLASS,
    category: WAITLIST_GUESTS_CAPACITY,
    name: 'Waitlist size per class',
    unit: COUNT,
    defaultValue: 4,
  }),
  defineRule({
    ruleKey: BookingRuleKey.WAITLIST_AUTO_BOOK,
    category: WAITLIST_GUESTS_CAPACITY,
    name: 'Auto-book first eligible waitlisted member',
    kind: FEATURE,
  }),
  defineRule({
    ruleKey: BookingRuleKey.OVERBOOKING_ENABLED,
    category: WAITLIST_GUESTS_CAPACITY,
    name: 'Overbooking enabled',
    kind: FEATURE,
  }),
  defineRule({
    ruleKey: BookingRuleKey.MAX_GUESTS_PER_MEMBER,
    category: WAITLIST_GUESTS_CAPACITY,
    name: 'Guests per member',
    unit: COUNT,
    defaultValue: 1,
  }),
  defineRule({
    ruleKey: BookingRuleKey.MAX_CLASSES_PER_WEEK,
    category: BOOKING_LIMIT,
    name: 'Classes per week',
    unit: COUNT,
    defaultValue: 2,
    defaultEnabled: false,
  }),
  defineRule({
    ruleKey: BookingRuleKey.APPOINTMENT_OPENS,
    category: APPOINTMENTS,
    name: 'Appointment booking opens before slot',
    unit: HOURS,
    defaultValue: 336,
  }),
  defineRule({
    ruleKey: BookingRuleKey.APPOINTMENT_CLOSES,
    category: APPOINTMENTS,
    name: 'Appointment booking closes before slot',
    unit: HOURS,
    defaultValue: 12,
  }),
  defineRule({
    ruleKey: BookingRuleKey.APPOINTMENT_FREE_CANCEL,
    category: APPOINTMENTS,
    name: 'Appointment free cancellation before slot',
    unit: HOURS,
    defaultValue: 12,
  }),
  defineRule({
    ruleKey: BookingRuleKey.FACILITY_FREE_CANCEL,
    category: FACILITIES,
    name: 'Facility free cancellation before slot',
    unit: HOURS,
    defaultValue: 1,
  }),
  defineRule({
    ruleKey: BookingRuleKey.CLIENT_SELF_PAUSE,
    category: MEMBERSHIPS_ACCOUNTS,
    name: 'Client self-pause',
    kind: FEATURE,
    defaultEnabled: false,
  }),
  defineRule({
    ruleKey: BookingRuleKey.CREDIT_OVERDRAFT,
    category: MEMBERSHIPS_ACCOUNTS,
    name: 'Credit overdraft',
    kind: FEATURE,
    defaultEnabled: false,
  }),
  defineRule({
    ruleKey: BookingRuleKey.CLASSPASS_ACCEPT,
    category: CLASSPASS,
    name: 'Accept ClassPass',
    kind: FEATURE,
  }),
]);

const findCatalogueEntry = (ruleKey) =>
  BOOKING_RULE_CATALOGUE.find((entry) => entry.ruleKey === ruleKey) ?? null;

module.exports = {
  BookingRuleCategory,
  BookingRuleUnit,
  BookingRuleValueType,
  BookingRuleKind,
  BookingRuleKey,
  BOOKING_RULE_CATEGORY_LABELS,
  UNIT_BOUNDS,
  API_TO_DB_CATEGORY,
  DB_TO_API_CATEGORY,
  API_TO_DB_UNIT,
  DB_TO_API_UNIT,
  BOOKING_RULE_CATALOGUE,
  valueTypeOf,
  findCatalogueEntry,
};
