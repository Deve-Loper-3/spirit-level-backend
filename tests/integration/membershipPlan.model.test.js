const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
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
const { deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(30000);

describe('MembershipPlan model & DB triggers', () => {
  const TEST_PREFIX = 'test_slmp01_model_';

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
  };

  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('bumps version when commercial fields change and keeps version unchanged for non-commercial updates', async () => {
    const plan = await prisma.membershipPlan.create({
      data: {
        id: crypto.randomUUID(),
        name: `${TEST_PREFIX}version_plan`,
        kind: PlanKind.SUBSCRIPTION,
        price: 500,
        billingCycle: PlanBillingCycle.MONTH,
        creditType: PlanCreditType.CLASS,
        creditsIncluded: 10,
        creditRefill: PlanCreditRefill.MONTHLY,
        validityValue: 1,
        validityUnit: PlanValidityUnit.MONTH,
        startsOn: PlanStartsOn.PURCHASE_DATE,
        visibility: PlanVisibility.PUBLIC,
        status: PlanStatus.ACTIVE,
        description: 'Original description',
        version: 1,
      },
    });

    expect(plan.version).toBe(1);

    // 1. Non-commercial update: description
    const updatedDesc = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { description: 'Updated description' },
    });
    expect(updatedDesc.version).toBe(1);
    expect(updatedDesc.description).toBe('Updated description');

    // 2. Non-commercial update: visibility
    const updatedVis = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { visibility: PlanVisibility.HIDDEN },
    });
    expect(updatedVis.version).toBe(1);

    // 3. Commercial update: price
    const updatedPrice = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { price: 550 },
    });
    expect(updatedPrice.version).toBe(2);

    // 4. Commercial update: creditsIncluded
    const updatedCredits = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { creditsIncluded: 12 },
    });
    expect(updatedCredits.version).toBe(3);

    // 5. Commercial update: validityValue
    const updatedValidity = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { validityValue: 2 },
    });
    expect(updatedValidity.version).toBe(4);
  });

  it('rejects duplicate names case-insensitively when status is not ARCHIVED and allows reuse when ARCHIVED', async () => {
    const originalName = `${TEST_PREFIX}case_test`;
    const uppercaseName = `${TEST_PREFIX}CASE_TEST`;

    const activePlan = await prisma.membershipPlan.create({
      data: {
        id: crypto.randomUUID(),
        name: originalName,
        kind: PlanKind.CREDIT_PACK,
        price: 100,
        billingCycle: PlanBillingCycle.ONE_OFF,
        creditType: PlanCreditType.CLASS,
        creditsIncluded: 1,
        creditRefill: PlanCreditRefill.ONCE,
        validityValue: 1,
        validityUnit: PlanValidityUnit.MONTH,
        startsOn: PlanStartsOn.FIRST_BOOKING,
        visibility: PlanVisibility.PUBLIC,
        status: PlanStatus.ACTIVE,
      },
    });

    // Attempt duplicate with uppercase should fail with P2002
    await expect(
      prisma.membershipPlan.create({
        data: {
          id: crypto.randomUUID(),
          name: uppercaseName,
          kind: PlanKind.CREDIT_PACK,
          price: 150,
          billingCycle: PlanBillingCycle.ONE_OFF,
          creditType: PlanCreditType.CLASS,
          creditsIncluded: 1,
          creditRefill: PlanCreditRefill.ONCE,
          validityValue: 1,
          validityUnit: PlanValidityUnit.MONTH,
          startsOn: PlanStartsOn.FIRST_BOOKING,
          visibility: PlanVisibility.PUBLIC,
          status: PlanStatus.ACTIVE,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Archive the original plan
    await prisma.membershipPlan.update({
      where: { id: activePlan.id },
      data: { status: PlanStatus.ARCHIVED },
    });

    // Now inserting the same name in uppercase succeeds because status is != ARCHIVED on the new one, and the old one is ARCHIVED
    const reusedPlan = await prisma.membershipPlan.create({
      data: {
        id: crypto.randomUUID(),
        name: uppercaseName,
        kind: PlanKind.CREDIT_PACK,
        price: 150,
        billingCycle: PlanBillingCycle.ONE_OFF,
        creditType: PlanCreditType.CLASS,
        creditsIncluded: 1,
        creditRefill: PlanCreditRefill.ONCE,
        validityValue: 1,
        validityUnit: PlanValidityUnit.MONTH,
        startsOn: PlanStartsOn.FIRST_BOOKING,
        visibility: PlanVisibility.PUBLIC,
        status: PlanStatus.ACTIVE,
      },
    });

    expect(reusedPlan.name).toBe(uppercaseName);
  });
});
