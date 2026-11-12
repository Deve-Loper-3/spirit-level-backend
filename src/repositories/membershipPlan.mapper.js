const {
  PlanCreditType,
  PlanSection,
  PlanCreditRefill,
  PLAN_EDITABLE_FIELDS,
} = require('../constants/membershipPlan');
const { pick } = require('../utils/pick.util');

const toSection = (creditType) =>
  (creditType || '').toUpperCase() === PlanCreditType.TIME
    ? PlanSection.ONLINE_COACHING
    : PlanSection.CLASS_MEMBERSHIP;

const toLower = (val) => (typeof val === 'string' ? val.toLowerCase() : val);

const formatCreditSummary = (plan) => {
  if (!plan) return '';
  const creditTypeUpper = (plan.creditType || '').toUpperCase();
  if (creditTypeUpper === PlanCreditType.TIME) {
    return 'Time-based access';
  }
  const typeLabels = {
    CLASS: 'class',
    APPOINTMENT: 'appointment',
    FACILITY: 'facility',
  };
  const typeLabel = typeLabels[creditTypeUpper] || creditTypeUpper.toLowerCase();
  const count = Number(plan.creditsIncluded);
  const unitLabel = count === 1 ? 'credit' : 'credits';
  const refillUpper = (plan.creditRefill || '').toUpperCase();
  const cadence = refillUpper === PlanCreditRefill.MONTHLY ? ' a month' : '';
  return `${count} ${typeLabel} ${unitLabel}${cadence}`;
};

// The editable fields of a plan row or of validated input, in one comparable shape (database
// enum values, price as a number, optional columns as null).
const toEditableFields = (source) => ({
  ...pick(source, PLAN_EDITABLE_FIELDS),
  price: Number(source.price),
  creditRefill: source.creditRefill ?? null,
  description: source.description ?? null,
  membershipId: source.membershipId ?? null,
  term: source.term ?? null,
  recurring: Boolean(source.recurring),
  joiningFee: Number(source.joiningFee ?? 0),
  periodMonths:
    source.periodMonths !== null && source.periodMonths !== undefined
      ? Number(source.periodMonths)
      : null,
});

const toMembershipPlanResponse = (plan, { activeClientCount = 0 } = {}) => {
  if (!plan) return null;
  const price =
    plan.price !== null && plan.price !== undefined && typeof plan.price.toNumber === 'function'
      ? plan.price.toNumber()
      : Number(plan.price);

  const joiningFee =
    plan.joiningFee !== null &&
    plan.joiningFee !== undefined &&
    typeof plan.joiningFee.toNumber === 'function'
      ? plan.joiningFee.toNumber()
      : Number(plan.joiningFee ?? 0);

  const membership = plan.membership
    ? {
        id: plan.membership.id,
        name: plan.membership.name,
        description: plan.membership.description ?? null,
      }
    : null;

  const creditSummary = formatCreditSummary(plan);

  return {
    id: plan.id,
    name: plan.name,
    kind: toLower(plan.kind),
    price,
    billingCycle: toLower(plan.billingCycle),
    creditType: toLower(plan.creditType),
    creditsIncluded: plan.creditsIncluded,
    creditRefill: plan.creditRefill ? toLower(plan.creditRefill) : null,
    validityValue: plan.validityValue,
    validityUnit: toLower(plan.validityUnit),
    startsOn: toLower(plan.startsOn),
    oneTimePurchasePerClient: Boolean(plan.oneTimePurchasePerClient),
    visibility: toLower(plan.visibility),
    status: toLower(plan.status),
    description: plan.description ?? null,
    version: plan.version,
    section: toSection(plan.creditType),
    creditSummary,
    activeClientCount,
    membershipId: plan.membershipId ?? null,
    membership,
    term: plan.term ?? null,
    recurring: Boolean(plan.recurring),
    periodMonths:
      plan.periodMonths !== null && plan.periodMonths !== undefined
        ? Number(plan.periodMonths)
        : null,
    joiningFee,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
};

module.exports = {
  formatCreditSummary,
  toSection,
  toEditableFields,
  toMembershipPlanResponse,
};
