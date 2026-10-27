const { toMembershipPlanResponse } = require('../../src/repositories/membershipPlan.mapper');
const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
  PlanValidityUnit,
  PlanStartsOn,
  PlanVisibility,
  PlanStatus,
  PlanSection,
} = require('../../src/constants/membershipPlan');

describe('membershipPlan.mapper - toMembershipPlanResponse', () => {
  const basePlan = {
    id: 'plan-1',
    name: 'Standard Class Pack',
    kind: PlanKind.CREDIT_PACK,
    price: 500,
    billingCycle: PlanBillingCycle.ONE_OFF,
    creditType: PlanCreditType.CLASS,
    creditsIncluded: 10,
    creditRefill: PlanCreditRefill.ONCE,
    validityValue: 1,
    validityUnit: PlanValidityUnit.MONTH,
    startsOn: PlanStartsOn.FIRST_BOOKING,
    oneTimePurchasePerClient: false,
    visibility: PlanVisibility.PUBLIC,
    status: PlanStatus.ACTIVE,
    description: '10 classes pack',
    externalRef: 'ext-123',
    version: 1,
    createdAt: new Date('2026-10-24T00:00:00.000Z'),
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
  };

  it('derives class_membership when creditType is CLASS, APPOINTMENT or FACILITY', () => {
    const classPlan = toMembershipPlanResponse(basePlan);
    expect(classPlan.section).toBe(PlanSection.CLASS_MEMBERSHIP);

    const apptPlan = toMembershipPlanResponse({
      ...basePlan,
      creditType: PlanCreditType.APPOINTMENT,
    });
    expect(apptPlan.section).toBe(PlanSection.CLASS_MEMBERSHIP);

    const facPlan = toMembershipPlanResponse({ ...basePlan, creditType: PlanCreditType.FACILITY });
    expect(facPlan.section).toBe(PlanSection.CLASS_MEMBERSHIP);
  });

  it('derives online_coaching when creditType is TIME', () => {
    const timePlan = toMembershipPlanResponse({
      ...basePlan,
      creditType: PlanCreditType.TIME,
      creditsIncluded: 0,
      creditRefill: null,
    });
    expect(timePlan.section).toBe(PlanSection.ONLINE_COACHING);
  });

  it('handles Prisma Decimal object for price', () => {
    const decimalPlan = {
      ...basePlan,
      price: {
        toNumber: () => 449.5,
      },
    };
    const res = toMembershipPlanResponse(decimalPlan);
    expect(res.price).toBe(449.5);
  });

  it('maps membershipId and nested membership when populated, null when standalone', () => {
    const standalone = toMembershipPlanResponse(basePlan);
    expect(standalone.membershipId).toBeNull();
    expect(standalone.membership).toBeNull();

    const withMem = toMembershipPlanResponse({
      ...basePlan,
      membershipId: 'mem-1',
      membership: { id: 'mem-1', name: 'Gold Club', description: 'VIP' },
    });
    expect(withMem.membershipId).toBe('mem-1');
    expect(withMem.membership).toEqual({
      id: 'mem-1',
      name: 'Gold Club',
      description: 'VIP',
    });
  });

  it('maps term, recurring, periodMonths, joiningFee, creditSummary, and creditNote', () => {
    const fullPlan = {
      ...basePlan,
      term: '12 Months',
      recurring: true,
      periodMonths: 12,
      joiningFee: { toNumber: () => 150 },
    };
    const res = toMembershipPlanResponse(fullPlan);
    expect(res.term).toBe('12 Months');
    expect(res.recurring).toBe(true);
    expect(res.periodMonths).toBe(12);
    expect(res.joiningFee).toBe(150);
    expect(res.creditSummary).toBe('10 class credits');
    expect(res.creditNote).toBe('10 class credits');
  });

  it('returns null when input is falsy', () => {
    expect(toMembershipPlanResponse(null)).toBeNull();
    expect(toMembershipPlanResponse(undefined)).toBeNull();
  });
});
