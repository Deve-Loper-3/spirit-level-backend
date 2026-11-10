const {
  createPlanSchema,
  validateCreatePlan,
} = require('../../src/validators/membershipPlan.validation');
const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanStatus,
} = require('../../src/constants/membershipPlan');

describe('Membership plan validation (SL-MP-02)', () => {
  const baseValidPayload = {
    name: 'Standard Membership',
    kind: 'subscription',
    price: 499.99,
    billingCycle: 'month',
    creditType: 'class',
    creditsIncluded: 12,
    creditRefill: 'monthly',
    validityValue: 1,
    validityUnit: 'month',
    startsOn: 'purchase_date',
    visibility: 'public',
  };

  it('validates a valid subscription plan with lowercase enums and coerces them to uppercase', () => {
    const result = createPlanSchema.safeParse(baseValidPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe(PlanKind.SUBSCRIPTION);
      expect(result.data.billingCycle).toBe(PlanBillingCycle.MONTH);
      expect(result.data.creditType).toBe(PlanCreditType.CLASS);
      expect(result.data.status).toBe(PlanStatus.ACTIVE);
      expect(result.data.creditsIncluded).toBe(12);
    }
  });

  it('accepts creditType TIME when creditsIncluded is 0 or omitted', () => {
    const timeOmitted = {
      ...baseValidPayload,
      creditType: 'time',
      creditRefill: null,
    };
    delete timeOmitted.creditsIncluded;

    const result = createPlanSchema.safeParse(timeOmitted);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditsIncluded).toBe(0);
    }

    const timeZero = {
      ...baseValidPayload,
      creditType: 'time',
      creditsIncluded: 0,
      creditRefill: null,
    };
    const result2 = createPlanSchema.safeParse(timeZero);
    expect(result2.success).toBe(true);
  });

  it('rejects creditType TIME when creditsIncluded > 0', () => {
    const invalidTime = {
      ...baseValidPayload,
      creditType: 'time',
      creditsIncluded: 5,
      creditRefill: null,
    };
    const result = createPlanSchema.safeParse(invalidTime);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditsIncluded'))).toBe(true);
  });

  it('rejects creditType CLASS when creditsIncluded is missing or 0', () => {
    const missingCredits = {
      ...baseValidPayload,
      creditType: 'class',
    };
    delete missingCredits.creditsIncluded;

    const res1 = createPlanSchema.safeParse(missingCredits);
    expect(res1.success).toBe(false);
    expect(res1.error.issues.some((i) => i.path.includes('creditsIncluded'))).toBe(true);

    const zeroCredits = {
      ...baseValidPayload,
      creditType: 'class',
      creditsIncluded: 0,
    };
    const res2 = createPlanSchema.safeParse(zeroCredits);
    expect(res2.success).toBe(false);
    expect(res2.error.issues.some((i) => i.path.includes('creditsIncluded'))).toBe(true);
  });

  it('rejects recurring billingCycle for non-subscription kind with exact message', () => {
    const invalidPack = {
      ...baseValidPayload,
      kind: 'credit_pack',
      billingCycle: 'month',
      creditRefill: null,
    };
    const result = createPlanSchema.safeParse(invalidPack);
    expect(result.success).toBe(false);
    const cycleIssue = result.error.issues.find((i) => i.path.includes('billingCycle'));
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue.message).toBe('Only a membership renews monthly.');
  });

  it('rejects creditRefill MONTHLY when billingCycle is not MONTH', () => {
    const invalidRefill = {
      ...baseValidPayload,
      billingCycle: 'quarter',
      creditRefill: 'monthly',
    };
    const result = createPlanSchema.safeParse(invalidRefill);
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path.includes('creditRefill'))).toBe(true);
  });

  it('validateCreatePlan middleware returns 400 with all failing fields together', () => {
    const badBody = {
      // Missing price
      name: 'Bad Plan',
      kind: 'credit_pack',
      billingCycle: 'month', // 1. recurring on credit_pack
      creditType: 'time',
      creditsIncluded: 5, // 2. time with credits > 0
      creditRefill: 'monthly', // 3. refill on time plan
      validityValue: 0, // 4. validityValue < 1
      validityUnit: 'month',
      startsOn: 'purchase_date',
      visibility: 'public',
      externalRef: 'should_be_stripped',
    };

    const req = { body: badBody };
    let responseStatus;
    let responseBody;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (body) => {
            responseBody = body;
            return body;
          },
        };
      },
    };
    const next = jest.fn();

    validateCreatePlan(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(responseStatus).toBe(400);
    expect(responseBody.success).toBe(false);
    expect(responseBody.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(responseBody.errors)).toBe(true);

    const errorFields = responseBody.errors.map((e) => e.field);
    expect(errorFields).toContain('price');
    expect(errorFields).toContain('billingCycle');
    expect(errorFields).toContain('creditsIncluded');
    expect(errorFields).toContain('creditRefill');
    expect(errorFields).toContain('validityValue');
    // Ensure externalRef was stripped before parse
    expect(req.body.externalRef).toBeUndefined();
  });

  it('rejects a single body with missing price, credit_pack/month, and time/creditsIncluded 5 returning all three fields together', () => {
    const payload = {
      name: 'Combined Error Plan',
      // missing price
      kind: 'credit_pack',
      billingCycle: 'month',
      creditType: 'time',
      creditsIncluded: 5,
      creditRefill: null,
      validityValue: 1,
      validityUnit: 'month',
      startsOn: 'purchase_date',
      visibility: 'public',
    };

    const req = { body: payload };
    let responseStatus;
    let responseBody;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (body) => {
            responseBody = body;
            return body;
          },
        };
      },
    };
    const next = jest.fn();

    validateCreatePlan(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(responseStatus).toBe(400);
    expect(responseBody.code).toBe('VALIDATION_ERROR');

    const errorFields = responseBody.errors.map((e) => e.field);
    expect(errorFields.sort()).toEqual(['billingCycle', 'creditsIncluded', 'price'].sort());
    expect(errorFields).toHaveLength(3);
  });
});
