const { membershipPlanSchema } = require('../../src/validators/membershipPlan.validation');
const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
  PlanValidityUnit,
  PlanStartsOn,
  PlanVisibility,
  PlanStatus,
} = require('../../src/constants/membershipPlan');

describe('membershipPlan.validation - membershipPlanSchema', () => {
  const validSubscription = {
    name: 'Base Membership (Monthly)',
    kind: PlanKind.SUBSCRIPTION,
    price: 449,
    billingCycle: PlanBillingCycle.MONTH,
    creditType: PlanCreditType.CLASS,
    creditsIncluded: 5,
    creditRefill: PlanCreditRefill.MONTHLY,
    validityValue: 1,
    validityUnit: PlanValidityUnit.MONTH,
    startsOn: PlanStartsOn.PURCHASE_DATE,
    oneTimePurchasePerClient: false,
    visibility: PlanVisibility.PUBLIC,
    status: PlanStatus.ACTIVE,
    description: '5 classes per month',
    externalRef: 'plan_code_1',
  };

  it('validates a valid monthly subscription plan', () => {
    const result = membershipPlanSchema.safeParse(validSubscription);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Base Membership (Monthly)');
      expect(result.data.price).toBe(449);
    }
  });

  it('validates a valid online coaching plan with TIME creditType', () => {
    const timePlan = {
      ...validSubscription,
      name: 'Hyrox Personalised Programming',
      creditType: PlanCreditType.TIME,
      creditsIncluded: 0,
      creditRefill: null,
    };
    const result = membershipPlanSchema.safeParse(timePlan);
    expect(result.success).toBe(true);
  });

  it('rejects TIME plan when creditsIncluded > 0', () => {
    const invalidTimePlan = {
      ...validSubscription,
      creditType: PlanCreditType.TIME,
      creditsIncluded: 5,
      creditRefill: null,
    };
    const result = membershipPlanSchema.safeParse(invalidTimePlan);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditsIncluded'))).toBe(true);
  });

  it('rejects TIME plan when creditRefill is not null', () => {
    const invalidTimePlan = {
      ...validSubscription,
      creditType: PlanCreditType.TIME,
      creditsIncluded: 0,
      creditRefill: PlanCreditRefill.MONTHLY,
    };
    const result = membershipPlanSchema.safeParse(invalidTimePlan);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditRefill'))).toBe(true);
  });

  it('rejects non-time plan when creditsIncluded is 0', () => {
    const invalidClassPlan = {
      ...validSubscription,
      creditType: PlanCreditType.CLASS,
      creditsIncluded: 0,
    };
    const result = membershipPlanSchema.safeParse(invalidClassPlan);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditsIncluded'))).toBe(true);
  });

  it('rejects creditRefill MONTHLY when billingCycle is not MONTH', () => {
    const invalidRefill = {
      ...validSubscription,
      billingCycle: PlanBillingCycle.QUARTER,
      creditRefill: PlanCreditRefill.MONTHLY,
    };
    const result = membershipPlanSchema.safeParse(invalidRefill);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditRefill'))).toBe(true);
  });

  it('rejects recurring billingCycle for non-SUBSCRIPTION kinds', () => {
    const invalidPack = {
      ...validSubscription,
      kind: PlanKind.CREDIT_PACK,
      billingCycle: PlanBillingCycle.MONTH,
      creditRefill: PlanCreditRefill.ONCE,
    };
    const result = membershipPlanSchema.safeParse(invalidPack);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('billingCycle'))).toBe(true);
  });

  it('accepts credit pack with billingCycle ONE_OFF and creditRefill ONCE', () => {
    const validPack = {
      ...validSubscription,
      kind: PlanKind.CREDIT_PACK,
      billingCycle: PlanBillingCycle.ONE_OFF,
      creditRefill: PlanCreditRefill.ONCE,
    };
    const result = membershipPlanSchema.safeParse(validPack);
    expect(result.success).toBe(true);
  });

  it('rejects invalid names, prices, and lengths', () => {
    expect(membershipPlanSchema.safeParse({ ...validSubscription, name: 'a' }).success).toBe(false);
    expect(
      membershipPlanSchema.safeParse({ ...validSubscription, name: 'x'.repeat(81) }).success,
    ).toBe(false);
    expect(membershipPlanSchema.safeParse({ ...validSubscription, price: -1 }).success).toBe(false);
    expect(membershipPlanSchema.safeParse({ ...validSubscription, price: 100001 }).success).toBe(
      false,
    );
    expect(
      membershipPlanSchema.safeParse({ ...validSubscription, description: 'd'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('coerces string price to number', () => {
    const result = membershipPlanSchema.safeParse({ ...validSubscription, price: '449.50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(449.5);
    }
  });

  it('validates membershipId (UUID) and rejects invalid format', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const validRes = membershipPlanSchema.safeParse({
      ...validSubscription,
      membershipId: validUuid,
    });
    expect(validRes.success).toBe(true);

    const invalidRes = membershipPlanSchema.safeParse({
      ...validSubscription,
      membershipId: 'not-a-uuid',
    });
    expect(invalidRes.success).toBe(false);
  });

  it('rejects mutual exclusivity violation when both membershipId and membership are provided', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const res = membershipPlanSchema.safeParse({
      ...validSubscription,
      membershipId: validUuid,
      membership: { name: 'New Membership' },
    });
    expect(res.success).toBe(false);
    expect(res.error.issues.some((i) => i.message.includes('mutually exclusive'))).toBe(true);
  });

  it('validates periodMonths allowed values (1, 3, 6, 12)', () => {
    for (const val of [1, 3, 6, 12]) {
      const res = membershipPlanSchema.safeParse({ ...validSubscription, periodMonths: val });
      expect(res.success).toBe(true);
    }
    const invalidRes = membershipPlanSchema.safeParse({ ...validSubscription, periodMonths: 5 });
    expect(invalidRes.success).toBe(false);
  });

  it('validates joiningFee defaults to 0 and rejects negative numbers', () => {
    const res = membershipPlanSchema.safeParse({ ...validSubscription, joiningFee: undefined });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.joiningFee).toBe(0);
    }

    const negRes = membershipPlanSchema.safeParse({ ...validSubscription, joiningFee: -10 });
    expect(negRes.success).toBe(false);
  });
});
