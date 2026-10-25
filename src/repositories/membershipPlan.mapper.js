const { PlanCreditType, PlanSection, PlanCreditRefill } = require('../constants/membershipPlan');

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

const toMembershipPlanResponse = (plan, { activeClientCount = 0 } = {}) => {
  if (!plan) return null;
  const price =
    plan.price !== null && plan.price !== undefined && typeof plan.price.toNumber === 'function'
      ? plan.price.toNumber()
      : Number(plan.price);

  const creditTypeUpper = (plan.creditType || '').toUpperCase();

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
    section:
      creditTypeUpper === PlanCreditType.TIME
        ? PlanSection.ONLINE_COACHING
        : PlanSection.CLASS_MEMBERSHIP,
    creditSummary: formatCreditSummary(plan),
    activeClientCount,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
};

module.exports = {
  formatCreditSummary,
  toMembershipPlanResponse,
};
