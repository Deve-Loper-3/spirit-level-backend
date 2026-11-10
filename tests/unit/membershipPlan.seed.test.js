const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
} = require('../../src/constants/membershipPlan');
const {
  deriveKind,
  deriveBillingCycle,
  deriveCreditRefill,
  recurringBillingFromDuration,
} = require('../../prisma/seeds/membership-plans.seed');

describe('membership-plans.seed derivations', () => {
  describe('recurringBillingFromDuration', () => {
    it('maps standard month durations to recurring cycles', () => {
      expect(recurringBillingFromDuration('1 month')).toBe(PlanBillingCycle.MONTH);
      expect(recurringBillingFromDuration('3 months')).toBe(PlanBillingCycle.QUARTER);
      expect(recurringBillingFromDuration('6 months')).toBe(PlanBillingCycle.HALF_YEAR);
      expect(recurringBillingFromDuration('12 months')).toBe(PlanBillingCycle.YEAR);
    });

    it('returns null for non-recurring durations', () => {
      expect(recurringBillingFromDuration('1 week')).toBeNull();
      expect(recurringBillingFromDuration('No expiry set (credits only)')).toBeNull();
      expect(recurringBillingFromDuration('')).toBeNull();
    });
  });

  describe('deriveKind', () => {
    it('returns TRIAL when Trial is yes', () => {
      expect(
        deriveKind({
          trialVal: 'Yes',
          planType: 'Credit pack (pay per session)',
          durationStr: '1 month',
          buyOnceVal: 'Yes',
        }),
      ).toBe(PlanKind.TRIAL);
    });

    it('returns SUBSCRIPTION for time-based plans', () => {
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Time-based (unlimited / access)',
          durationStr: '1 month',
          buyOnceVal: 'No',
        }),
      ).toBe(PlanKind.SUBSCRIPTION);
    });

    it('returns SUBSCRIPTION for credit-based recurring memberships (not buy-once)', () => {
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Credit pack (pay per session)',
          durationStr: '1 month',
          buyOnceVal: 'No',
        }),
      ).toBe(PlanKind.SUBSCRIPTION);
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Credit pack (pay per session)',
          durationStr: '3 months',
          buyOnceVal: 'No',
        }),
      ).toBe(PlanKind.SUBSCRIPTION);
    });

    it('returns CREDIT_PACK for buy-once or non-recurring credit plans', () => {
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Credit pack (pay per session)',
          durationStr: '1 month',
          buyOnceVal: 'Yes',
        }),
      ).toBe(PlanKind.CREDIT_PACK);
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Credit pack (pay per session)',
          durationStr: 'No expiry set (credits only)',
          buyOnceVal: 'No',
        }),
      ).toBe(PlanKind.CREDIT_PACK);
    });
  });

  describe('deriveBillingCycle + deriveCreditRefill', () => {
    it('gives monthly refill for credit subscription with 1-month duration', () => {
      const kind = PlanKind.SUBSCRIPTION;
      const billingCycle = deriveBillingCycle(kind, '1 month');
      expect(billingCycle).toBe(PlanBillingCycle.MONTH);
      expect(
        deriveCreditRefill(kind, billingCycle, PlanCreditType.CLASS, 15),
      ).toBe(PlanCreditRefill.MONTHLY);
    });

    it('keeps one-off + once for credit packs', () => {
      const kind = PlanKind.CREDIT_PACK;
      const billingCycle = deriveBillingCycle(kind, '1 month');
      expect(billingCycle).toBe(PlanBillingCycle.ONE_OFF);
      expect(
        deriveCreditRefill(kind, billingCycle, PlanCreditType.CLASS, 5),
      ).toBe(PlanCreditRefill.ONCE);
    });
  });
});
