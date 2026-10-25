const path = require('path');
const { runSeed } = require('../../prisma/seeds/membership-plans.seed');
const { deleteTestPlans } = require('../helpers/membershipPlan.helper');
const { findByExternalRef } = require('../../src/repositories/membershipPlan.repository');
const { toMembershipPlanResponse } = require('../../src/repositories/membershipPlan.mapper');
const { PlanCreditType, PlanKind, PlanSection } = require('../../src/constants/membershipPlan');

jest.setTimeout(30000);

describe('membership-plans.seed runner with fixture', () => {
  const TEST_PREFIX = 'test_slmp01_';
  const fixturePath = path.join(__dirname, '../fixtures/test_membership_plans.xlsx');

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
  };

  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('reads fixture, creates valid plans, skips invalid rows, and is idempotent on rerun', async () => {
    // 1. First run
    const result1 = await runSeed(fixturePath);
    expect(result1.stats.totalRead).toBe(4);
    expect(result1.stats.created).toBe(3);
    expect(result1.stats.updated).toBe(0);
    expect(result1.stats.skipped).toBe(1);
    expect(result1.skippedList).toHaveLength(1);
    expect(result1.skippedList[0].planCode).toBe('test_code_004');

    // 2. Check stored data
    const timePlan = await findByExternalRef('test_code_001');
    expect(timePlan).not.toBeNull();
    expect(timePlan.name).toBe('test_slmp01_time_plan');
    expect(timePlan.creditType).toBe(PlanCreditType.TIME);
    expect(timePlan.creditsIncluded).toBe(0);
    const mappedTime = toMembershipPlanResponse(timePlan);
    expect(mappedTime.section).toBe(PlanSection.ONLINE_COACHING);

    const packPlan = await findByExternalRef('test_code_002');
    expect(packPlan).not.toBeNull();
    expect(packPlan.name).toBe('test_slmp01_credit_pack');
    expect(packPlan.creditsIncluded).toBe(5);
    const mappedPack = toMembershipPlanResponse(packPlan);
    expect(mappedPack.section).toBe(PlanSection.CLASS_MEMBERSHIP);

    const trialPlan = await findByExternalRef('test_code_003');
    expect(trialPlan).not.toBeNull();
    expect(trialPlan.kind).toBe(PlanKind.TRIAL);
    expect(trialPlan.oneTimePurchasePerClient).toBe(true);

    // 3. Second run (idempotency)
    const result2 = await runSeed(fixturePath);
    expect(result2.stats.totalRead).toBe(4);
    expect(result2.stats.created).toBe(0);
    expect(result2.stats.updated).toBe(3);
    expect(result2.stats.skipped).toBe(1);
  });
});
