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
  deriveRecurring,
  derivePeriodMonths,
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

    it.each([
      ['1 week'],
      ['2 weeks'],
      ['10 days'],
      ['2 months'],
      ['9 months'],
      ['No expiry set (credits only)'],
      [''],
    ])('does not make a time-based plan with duration "%s" a SUBSCRIPTION', (durationStr) => {
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Time-based with class credits',
          durationStr,
          buyOnceVal: 'No',
        }),
      ).toBe(PlanKind.CREDIT_PACK);
    });

    it('does not renew a buy-once time-based plan even with a standard duration', () => {
      expect(
        deriveKind({
          trialVal: 'No',
          planType: 'Time-based (unlimited / access)',
          durationStr: '1 month',
          buyOnceVal: 'Yes',
        }),
      ).toBe(PlanKind.CREDIT_PACK);
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

  describe('deriveRecurring + derivePeriodMonths', () => {
    it.each([
      [PlanBillingCycle.MONTH, 1],
      [PlanBillingCycle.QUARTER, 3],
      [PlanBillingCycle.HALF_YEAR, 6],
      [PlanBillingCycle.YEAR, 12],
    ])('a SUBSCRIPTION billed %s renews and has period %i months', (cycle, months) => {
      expect(deriveRecurring(PlanKind.SUBSCRIPTION, cycle)).toBe(true);
      expect(derivePeriodMonths(PlanKind.SUBSCRIPTION, cycle)).toBe(months);
    });

    it.each([PlanKind.CREDIT_PACK, PlanKind.TRIAL, PlanKind.SINGLE_VISIT])(
      'a %s never renews and has no period',
      (kind) => {
        expect(deriveRecurring(kind, PlanBillingCycle.ONE_OFF)).toBe(false);
        expect(derivePeriodMonths(kind, PlanBillingCycle.ONE_OFF)).toBeNull();
      },
    );

    it('a one-off cycle never renews, even for a SUBSCRIPTION', () => {
      expect(deriveRecurring(PlanKind.SUBSCRIPTION, PlanBillingCycle.ONE_OFF)).toBe(false);
      expect(derivePeriodMonths(PlanKind.SUBSCRIPTION, PlanBillingCycle.ONE_OFF)).toBeNull();
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
