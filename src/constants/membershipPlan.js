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
  COMMERCIAL_FIELDS,
  PLAN_NAME_MIN_LENGTH,
  PLAN_NAME_MAX_LENGTH,
  PLAN_PRICE_MIN,
  PLAN_PRICE_MAX,
  PLAN_DESCRIPTION_MAX_LENGTH,
};
