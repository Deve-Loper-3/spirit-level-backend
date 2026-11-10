const planService = require('../../src/services/plan.service');
const membershipPlanRepository = require('../../src/repositories/membershipPlan.repository');
const userRepository = require('../../src/repositories/user.repository');
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
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

jest.mock('../../src/repositories/membershipPlan.repository');
jest.mock('../../src/repositories/user.repository');

describe('plan.service - createPlan', () => {
  const actor = {
    id: 'admin-uuid-1',
    role: Role.ADMIN,
    email: 'admin@test.invalid',
  };

  const meta = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test',
  };

  const validPayload = {
    name: '  Gold Class Membership  ',
    kind: PlanKind.SUBSCRIPTION,
    price: 350.5,
    billingCycle: PlanBillingCycle.MONTH,
    creditType: PlanCreditType.CLASS,
    creditsIncluded: 15,
    creditRefill: PlanCreditRefill.MONTHLY,
    validityValue: 1,
    validityUnit: PlanValidityUnit.MONTH,
    startsOn: PlanStartsOn.PURCHASE_DATE,
    oneTimePurchasePerClient: false,
    visibility: PlanVisibility.PUBLIC,
    description: '15 classes a month',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates plan with trimmed name, status ACTIVE, version 1, and writes audit entry', async () => {
    membershipPlanRepository.findActiveByName.mockResolvedValue(null);

    const createdPlanRow = {
      id: 'created-plan-uuid',
      name: 'Gold Class Membership',
      kind: PlanKind.SUBSCRIPTION,
      price: 350.5,
      billingCycle: PlanBillingCycle.MONTH,
      creditType: PlanCreditType.CLASS,
      creditsIncluded: 15,
      creditRefill: PlanCreditRefill.MONTHLY,
      validityValue: 1,
      validityUnit: PlanValidityUnit.MONTH,
      startsOn: PlanStartsOn.PURCHASE_DATE,
      oneTimePurchasePerClient: false,
      visibility: PlanVisibility.PUBLIC,
      status: PlanStatus.ACTIVE,
      description: '15 classes a month',
      externalRef: null,
      version: 1,
      createdAt: new Date('2026-10-25T10:00:00.000Z'),
      updatedAt: new Date('2026-10-25T10:00:00.000Z'),
    };

    membershipPlanRepository.createPlanWithAudit.mockResolvedValue(createdPlanRow);

    const result = await planService.createPlan({
      actor,
      payload: validPayload,
      meta,
    });

    // 1. Verifies trimmed name in uniqueness check
    expect(membershipPlanRepository.findActiveByName).toHaveBeenCalledWith('Gold Class Membership');

    // 2. Verifies createPlanWithAudit called with correct data
    expect(membershipPlanRepository.createPlanWithAudit).toHaveBeenCalledTimes(1);
    const callArg = membershipPlanRepository.createPlanWithAudit.mock.calls[0][0];
    expect(callArg.planData.name).toBe('Gold Class Membership');
    expect(callArg.planData.status).toBe(PlanStatus.ACTIVE);
    expect(callArg.planData.externalRef).toBeUndefined();
    expect(callArg.auditData).toMatchObject({
      action: AuditAction.PLAN_CREATED,
      actorId: actor.id,
      actorRole: actor.role,
      email: actor.email,
      userId: null,
      meta,
    });

    // 3. Verifies response formatting: lowercase enums, numeric price, activeClientCount = 0
    expect(result).toMatchObject({
      id: 'created-plan-uuid',
      name: 'Gold Class Membership',
      kind: 'subscription',
      price: 350.5,
      billingCycle: 'month',
      creditType: 'class',
      creditsIncluded: 15,
      creditRefill: 'monthly',
      validityValue: 1,
      validityUnit: 'month',
      startsOn: 'purchase_date',
      visibility: 'public',
      status: 'active',
      version: 1,
      section: 'class_membership',
      creditSummary: '15 class credits a month',
      activeClientCount: 0,
    });
    expect(typeof result.price).toBe('number');
  });

  it('throws 409 PLAN_DUPLICATE_NAME when active plan with same name already exists', async () => {
    membershipPlanRepository.findActiveByName.mockResolvedValue({ id: 'existing-id' });

    await expect(
      planService.createPlan({
        actor,
        payload: validPayload,
        meta,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_DUPLICATE_NAME',
    });

    expect(membershipPlanRepository.createPlanWithAudit).not.toHaveBeenCalled();
  });

  it('maps DB P2002 race condition on partial unique index to 409 PLAN_DUPLICATE_NAME', async () => {
    membershipPlanRepository.findActiveByName.mockResolvedValue(null);

    const p2002Error = new Error('Unique constraint failed on the fields: (lower(name))');
    p2002Error.code = 'P2002';
    p2002Error.meta = { target: ['membership_plans_name_lower_active_idx'] };

    membershipPlanRepository.createPlanWithAudit.mockRejectedValue(p2002Error);

    await expect(
      planService.createPlan({
        actor,
        payload: validPayload,
        meta,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLAN_DUPLICATE_NAME',
    });
  });

  it('re-throws other non-unique DB errors', async () => {
    membershipPlanRepository.findActiveByName.mockResolvedValue(null);
    const dbErr = new Error('DB connection failed');
    membershipPlanRepository.createPlanWithAudit.mockRejectedValue(dbErr);

    await expect(
      planService.createPlan({
        actor,
        payload: validPayload,
        meta,
      }),
    ).rejects.toThrow('DB connection failed');
  });

  it('loads actor email from DB when controller does not pass it', async () => {
    membershipPlanRepository.findActiveByName.mockResolvedValue(null);
    userRepository.findAuthWithEmailById.mockResolvedValue({
      id: actor.id,
      email: 'looked-up@test.invalid',
      role: Role.ADMIN,
      status: 'ACTIVE',
    });
    membershipPlanRepository.createPlanWithAudit.mockResolvedValue({
      id: 'created-plan-uuid',
      name: 'Gold Class Membership',
      kind: PlanKind.SUBSCRIPTION,
      price: 350.5,
      billingCycle: PlanBillingCycle.MONTH,
      creditType: PlanCreditType.CLASS,
      creditsIncluded: 15,
      creditRefill: PlanCreditRefill.MONTHLY,
      validityValue: 1,
      validityUnit: PlanValidityUnit.MONTH,
      startsOn: PlanStartsOn.PURCHASE_DATE,
      oneTimePurchasePerClient: false,
      visibility: PlanVisibility.PUBLIC,
      status: PlanStatus.ACTIVE,
      description: '15 classes a month',
      externalRef: null,
      version: 1,
      createdAt: new Date('2026-10-25T10:00:00.000Z'),
      updatedAt: new Date('2026-10-25T10:00:00.000Z'),
    });

    await planService.createPlan({
      actor: { id: actor.id, role: actor.role },
      payload: validPayload,
      meta,
    });

    expect(userRepository.findAuthWithEmailById).toHaveBeenCalledWith(actor.id);
    expect(membershipPlanRepository.createPlanWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        auditData: expect.objectContaining({ email: 'looked-up@test.invalid' }),
      }),
    );
  });
});
