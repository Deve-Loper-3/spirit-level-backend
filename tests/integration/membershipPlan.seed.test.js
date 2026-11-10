const path = require('path');
const { runSeed } = require('../../prisma/seeds/membership-plans.seed');
const {
  deleteTestPlans,
  createTestMembership,
  deleteTestMemberships,
} = require('../helpers/membershipPlan.helper');
const { findByExternalRef } = require('../../src/repositories/membershipPlan.repository');
const { toMembershipPlanResponse } = require('../../src/repositories/membershipPlan.mapper');
const {
  PlanBillingCycle,
  PlanCreditRefill,
  PlanCreditType,
  PlanKind,
  PlanSection,
} = require('../../src/constants/membershipPlan');
const prisma = require('../../src/config/prisma');

jest.setTimeout(30000);

describe('membership-plans.seed runner with fixture', () => {
  const TEST_PREFIX = 'test_slmp01_';
  const fixturePath = path.join(__dirname, '../fixtures/test_membership_plans.xlsx');

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
    await deleteTestMemberships(TEST_PREFIX);
    await prisma.membership.deleteMany({
      where: {
        name: {
          startsWith: 'Test Membership',
        },
      },
    });
  };

  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('reads fixture, creates valid plans, skips invalid/missing-code rows, groups memberships, respects null-only, and is idempotent on rerun', async () => {
    // 1. First run
    const result1 = await runSeed(fixturePath);
    expect(result1.stats.totalRead).toBe(6);
    expect(result1.stats.created).toBe(4);
    expect(result1.stats.updated).toBe(0);
    expect(result1.stats.skipped).toBe(2);
    expect(result1.skippedList).toHaveLength(2);
    expect(result1.skippedList.map((s) => s.planCode)).toEqual(
      expect.arrayContaining([null, 'test_code_004']),
    );
    expect(
      result1.skippedList.some((s) => String(s.reason).includes('Missing Glofox plan code')),
    ).toBe(true);

    // 2. Check stored data & membership linking
    const timePlan = await findByExternalRef('test_code_001');
    expect(timePlan).not.toBeNull();
    expect(timePlan.name).toBe('test_slmp01_time_plan');
    expect(timePlan.creditType).toBe(PlanCreditType.TIME);
    expect(timePlan.creditsIncluded).toBe(0);
    expect(timePlan.membershipId).toBeTruthy();

    const timeMembership = await prisma.membership.findUnique({
      where: { id: timePlan.membershipId },
    });
    expect(timeMembership).not.toBeNull();
    expect(timeMembership.name).toBe('Test Membership Time');

    const mappedTime = toMembershipPlanResponse(timePlan);
    expect(mappedTime.section).toBe(PlanSection.ONLINE_COACHING);
    expect(mappedTime.membershipId).toBe(timePlan.membershipId);
    expect(mappedTime.membership.name).toBe('Test Membership Time');

    const packPlan = await findByExternalRef('test_code_002');
    expect(packPlan).not.toBeNull();
    expect(packPlan.name).toBe('test_slmp01_credit_pack');
    expect(packPlan.kind).toBe(PlanKind.CREDIT_PACK);
    expect(packPlan.billingCycle).toBe(PlanBillingCycle.ONE_OFF);
    expect(packPlan.creditRefill).toBe(PlanCreditRefill.ONCE);
    expect(packPlan.creditsIncluded).toBe(5);
    const mappedPack = toMembershipPlanResponse(packPlan);
    expect(mappedPack.section).toBe(PlanSection.CLASS_MEMBERSHIP);

    const trialPlan = await findByExternalRef('test_code_003');
    expect(trialPlan).not.toBeNull();
    expect(trialPlan.kind).toBe(PlanKind.TRIAL);
    expect(trialPlan.oneTimePurchasePerClient).toBe(true);

    const monthlyPlan = await findByExternalRef('test_code_006');
    expect(monthlyPlan).not.toBeNull();
    expect(monthlyPlan.kind).toBe(PlanKind.SUBSCRIPTION);
    expect(monthlyPlan.billingCycle).toBe(PlanBillingCycle.MONTH);
    expect(monthlyPlan.creditRefill).toBe(PlanCreditRefill.MONTHLY);
    expect(monthlyPlan.creditsIncluded).toBe(15);

    // 3. Manual reassignment: must not be overwritten by seed rerun
    const manualMem = await createTestMembership(TEST_PREFIX, {
      name: `${TEST_PREFIX}Manual Custom`,
    });
    await prisma.membershipPlan.update({
      where: { id: timePlan.id },
      data: { membershipId: manualMem.id },
    });

    // 4. Second run (idempotency + does NOT overwrite manual reassignment)
    const result2 = await runSeed(fixturePath);
    expect(result2.stats.totalRead).toBe(6);
    expect(result2.stats.created).toBe(0);
    expect(result2.stats.updated).toBe(4);
    expect(result2.stats.skipped).toBe(2);

    const reloadedTimePlan = await findByExternalRef('test_code_001');
    expect(reloadedTimePlan.membershipId).toBe(manualMem.id);

    // 5. Null-only backfill: if membershipId is null, seed populates it
    await prisma.membershipPlan.update({
      where: { id: timePlan.id },
      data: { membershipId: null },
    });
    const result3 = await runSeed(fixturePath);
    expect(result3.stats.updated).toBe(4);
    const backfilledTimePlan = await findByExternalRef('test_code_001');
    expect(backfilledTimePlan.membershipId).toBe(timeMembership.id);
  });
});
