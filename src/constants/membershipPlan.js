const PlanKind = Object.freeze({
  SUBSCRIPTION: 'SUBSCRIPTION',
  CREDIT_PACK: 'CREDIT_PACK',
  SINGLE_VISIT: 'SINGLE_VISIT',
  TRIAL: 'TRIAL',
});

const PlanBillingCycle = Object.freeze({
  MONTH: 'MONTH',
  QUARTER: 'QUARTER',
  HALF_YEAR: 'HALF_YEAR',
  YEAR: 'YEAR',
  ONE_OFF: 'ONE_OFF',
});

const PlanCreditType = Object.freeze({
  CLASS: 'CLASS',
  APPOINTMENT: 'APPOINTMENT',
  FACILITY: 'FACILITY',
  TIME: 'TIME',
});

const PlanCreditRefill = Object.freeze({
  MONTHLY: 'MONTHLY',
  ONCE: 'ONCE',
});

const PlanValidityUnit = Object.freeze({
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
});

const PlanStartsOn = Object.freeze({
  PURCHASE_DATE: 'PURCHASE_DATE',
  FIRST_BOOKING: 'FIRST_BOOKING',
});

const PlanVisibility = Object.freeze({
  PUBLIC: 'PUBLIC',
  HIDDEN: 'HIDDEN',
});

const PlanStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
});

const PlanSection = Object.freeze({
  ONLINE_COACHING: 'online_coaching',
  CLASS_MEMBERSHIP: 'class_membership',
});

const PLAN_SORT_FIELDS = Object.freeze(['name', 'price', 'createdAt']);
const PLAN_DEFAULT_SORT = 'name';

// Shown to staff and matched by the list search, so "trial" also finds kind TRIAL.
const PLAN_KIND_LABELS = Object.freeze({
  [PlanKind.SUBSCRIPTION]: 'Subscription',
  [PlanKind.CREDIT_PACK]: 'Credit pack',
  [PlanKind.SINGLE_VISIT]: 'Single visit',
  [PlanKind.TRIAL]: 'Trial',
});

// The list hides archived plans unless the caller asks for them.
const PLAN_LIST_DEFAULT_STATUSES = Object.freeze([PlanStatus.ACTIVE, PlanStatus.INACTIVE]);

// Short form of a plan in the list; the rest comes from the same mapper as the detail view.
const PLAN_LIST_ITEM_FIELDS = Object.freeze([
  'id',
  'name',
  'section',
  'kind',
  'price',
  'billingCycle',
  'creditType',
  'creditSummary',
  'visibility',
  'status',
  'activeClientCount',
]);

const COMMERCIAL_FIELDS = Object.freeze([
  'price',
  'billingCycle',
  'creditType',
  'creditsIncluded',
  'creditRefill',
  'validityValue',
  'validityUnit',
]);

const PLAN_NAME_MIN_LENGTH = 2;
const PLAN_NAME_MAX_LENGTH = 80;
const PLAN_PRICE_MIN = 0;
const PLAN_PRICE_MAX = 100000;
const PLAN_DESCRIPTION_MAX_LENGTH = 500;
const PLAN_SEARCH_MAX_LENGTH = 100;

module.exports = {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
  PlanValidityUnit,
  PlanStartsOn,
  PlanVisibility,
  PlanStatus,
  PlanSection,
  PLAN_SORT_FIELDS,
  PLAN_DEFAULT_SORT,
  PLAN_KIND_LABELS,
  PLAN_LIST_DEFAULT_STATUSES,
  PLAN_LIST_ITEM_FIELDS,
  COMMERCIAL_FIELDS,
  PLAN_NAME_MIN_LENGTH,
  PLAN_NAME_MAX_LENGTH,
  PLAN_PRICE_MIN,
  PLAN_PRICE_MAX,
  PLAN_DESCRIPTION_MAX_LENGTH,
  PLAN_SEARCH_MAX_LENGTH,
};
