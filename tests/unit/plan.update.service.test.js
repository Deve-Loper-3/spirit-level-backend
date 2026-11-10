const { getPlan, updatePlan, changePlanStatus } = require('../../src/services/plan.service');
const repository = require('../../src/repositories/membershipPlan.repository');
const { AuditAction } = require('../../src/constants/audit');
const { PLAN_STATUS_TRANSITIONS } = require('../../src/constants/membershipPlan');
const { Role } = require('../../src/constants/roles');

jest.mock('../../src/repositories/membershipPlan.repository');

const actor = { id: 'admin-1', role: Role.ADMIN, email: 'admin@test.invalid' };
const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

const planRow = (overrides = {}) => ({
  id: 'plan-1',
  name: 'Gold Class',
  kind: 'SUBSCRIPTION',
  price: 350,
  billingCycle: 'MONTH',
  creditType: 'CLASS',
  creditsIncluded: 15,
  creditRefill: 'MONTHLY',
  validityValue: 1,
  validityUnit: 'MONTH',
  startsOn: 'PURCHASE_DATE',
  oneTimePurchasePerClient: false,
  visibility: 'PUBLIC',
  status: 'ACTIVE',
  description: 'old text',
  version: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  ...overrides,
});

const errorOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
};

beforeEach(() => {
  jest.resetAllMocks();
  repository.countActiveClients.mockResolvedValue(0);
  repository.findActiveByName.mockResolvedValue(null);
});

describe('getPlan', () => {
  it('returns the full SL-MP-02 shape with the active client count from the repository', async () => {
    repository.countActiveClients.mockResolvedValue(4);

    const result = await getPlan({ plan: planRow({ status: 'ARCHIVED' }) });

    expect(result).toMatchObject({
      id: 'plan-1',
      status: 'archived',
      section: 'class_membership',
      creditSummary: '15 class credits a month',
      version: 1,
      activeClientCount: 4,
    });
  });
});

describe('updatePlan', () => {
  const run = (plan, changes) => updatePlan({ actor, plan, next: { ...plan, ...changes }, meta });

  it('writes only the changed fields, with the old and new values in the audit', async () => {
    const plan = planRow();
    repository.updatePlanWithAudit.mockImplementation(async ({ auditFor }) => {
      const updated = planRow({ price: 400, description: 'new text', version: 2 });
      repository.lastAudit = auditFor(updated);
      return updated;
    });

    const result = await run(plan, { price: 400, description: 'new text' });

    const call = repository.updatePlanWithAudit.mock.calls[0][0];
    expect(call.id).toBe('plan-1');
    expect(call.data).toEqual({ price: 400, description: 'new text' });
    expect(repository.lastAudit).toMatchObject({
      action: AuditAction.PLAN_UPDATED,
      actorId: 'admin-1',
      actorRole: Role.ADMIN,
      meta,
      details: {
        changes: {
          price: { from: 350, to: 400 },
          description: { from: 'old text', to: 'new text' },
        },
        version: { from: 1, to: 2 },
      },
    });
    expect(result.version).toBe(2);
    expect(result.price).toBe(400);
  });

  it('writes nothing and no audit when no value really changes', async () => {
    const plan = planRow();

    const result = await run(plan, { price: 350, description: 'old text' });

    expect(repository.updatePlanWithAudit).not.toHaveBeenCalled();
    expect(result.version).toBe(1);
  });

  it('treats a price sent as the same number as unchanged', async () => {
    const plan = planRow({ price: { toNumber: () => 350, valueOf: () => '350.00' } });
    await run(plan, { price: 350 });
    expect(repository.updatePlanWithAudit).not.toHaveBeenCalled();
  });

  it('trims the new name before saving', async () => {
    repository.updatePlanWithAudit.mockResolvedValue(planRow({ name: 'Platinum' }));
    await run(planRow(), { name: '  Platinum  ' });
    expect(repository.updatePlanWithAudit.mock.calls[0][0].data).toEqual({ name: 'Platinum' });
  });

  describe('PLAN_DUPLICATE_NAME', () => {
    it('is 409 when another plan has the name, and excludes the plan itself from the check', async () => {
      repository.findActiveByName.mockResolvedValue(planRow({ id: 'other' }));

      const err = await errorOf(run(planRow(), { name: 'Silver' }));

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_DUPLICATE_NAME' });
      expect(repository.findActiveByName).toHaveBeenCalledWith('Silver', undefined, {
        excludeId: 'plan-1',
      });
      expect(repository.updatePlanWithAudit).not.toHaveBeenCalled();
    });

    it('does not check the name when it is not changing', async () => {
      repository.updatePlanWithAudit.mockResolvedValue(planRow({ price: 1 }));
      await run(planRow(), { price: 1 });
      expect(repository.findActiveByName).not.toHaveBeenCalled();
    });

    it('maps a unique-index race to 409 PLAN_DUPLICATE_NAME', async () => {
      const race = Object.assign(new Error('unique'), { code: 'P2002' });
      repository.updatePlanWithAudit.mockRejectedValue(race);

      const err = await errorOf(run(planRow(), { name: 'Silver' }));

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_DUPLICATE_NAME' });
    });
  });

  describe('PLAN_IN_USE', () => {
    const toTime = { creditType: 'TIME', creditsIncluded: 0, creditRefill: null };

    it('is 409 when a plan with active clients switches from credits to time', async () => {
      repository.countActiveClients.mockResolvedValue(2);

      const err = await run(planRow(), toTime).catch((e) => e);

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_IN_USE' });
      expect(repository.updatePlanWithAudit).not.toHaveBeenCalled();
    });

    it('is 409 when a plan with active clients switches from time to credits', async () => {
      repository.countActiveClients.mockResolvedValue(1);
      const plan = planRow({ creditType: 'TIME', creditsIncluded: 0, creditRefill: null });

      const err = await run(plan, { creditType: 'CLASS', creditsIncluded: 5 }).catch((e) => e);

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_IN_USE' });
    });

    it('allows the switch when nobody uses the plan', async () => {
      repository.updatePlanWithAudit.mockResolvedValue(planRow({ ...toTime, version: 2 }));

      const result = await run(planRow(), toTime);

      expect(result.creditType).toBe('time');
    });

    it('allows a change between two credit types even with active clients', async () => {
      repository.countActiveClients.mockResolvedValue(9);
      repository.updatePlanWithAudit.mockResolvedValue(planRow({ creditType: 'APPOINTMENT' }));

      await run(planRow(), { creditType: 'APPOINTMENT' });

      expect(repository.updatePlanWithAudit).toHaveBeenCalled();
    });

    it('is checked after the name', async () => {
      repository.countActiveClients.mockResolvedValue(2);
      repository.findActiveByName.mockResolvedValue(planRow({ id: 'other' }));

      const err = await run(planRow(), { ...toTime, name: 'Silver' }).catch((e) => e);

      expect(err.code).toBe('PLAN_DUPLICATE_NAME');
    });
  });

  it('is 409 PLAN_ARCHIVED when the plan was archived between the read and the write', async () => {
    repository.updatePlanWithAudit.mockResolvedValue(null);

    const err = await errorOf(run(planRow(), { price: 1 }));

    expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_ARCHIVED' });
  });
});

describe('changePlanStatus', () => {
  const change = (plan, status, reason) => changePlanStatus({ actor, plan, status, reason, meta });

  const ALL = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];

  it('has exactly the allowed transitions', () => {
    expect(PLAN_STATUS_TRANSITIONS).toEqual({
      ACTIVE: ['INACTIVE', 'ARCHIVED'],
      INACTIVE: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: ['INACTIVE'],
    });
  });

  describe.each(
    ALL.flatMap((from) =>
      ALL.filter((to) => to !== from).map((to) => [
        from,
        to,
        PLAN_STATUS_TRANSITIONS[from].includes(to),
      ]),
    ),
  )('%s -> %s', (from, to, allowed) => {
    if (allowed) {
      it('is allowed: updates the status and writes the audit', async () => {
        repository.changePlanStatusWithAudit.mockImplementation(async ({ auditFor }) => {
          repository.lastAudit = auditFor();
          return planRow({ status: to });
        });

        const result = await change(planRow({ status: from }), to, 'because');

        expect(result).toEqual({
          id: 'plan-1',
          status: to.toLowerCase(),
          updatedAt: expect.any(Date),
        });
        expect(repository.changePlanStatusWithAudit.mock.calls[0][0]).toMatchObject({
          id: 'plan-1',
          from,
          to,
        });
        expect(repository.lastAudit).toMatchObject({
          action: AuditAction.PLAN_STATUS_CHANGED,
          actorId: 'admin-1',
          details: { from: from.toLowerCase(), to: to.toLowerCase(), reason: 'because' },
        });
      });
    } else {
      it('is 409 PLAN_INVALID_TRANSITION and writes nothing', async () => {
        const err = await errorOf(change(planRow({ status: from }), to));

        expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_INVALID_TRANSITION' });
        expect(repository.changePlanStatusWithAudit).not.toHaveBeenCalled();
      });
    }
  });

  it.each(ALL)('the same status (%s) is a 200 with no write and no audit', async (status) => {
    const plan = planRow({ status });

    const result = await change(plan, status, 'noop');

    expect(result).toEqual({
      id: 'plan-1',
      status: status.toLowerCase(),
      updatedAt: plan.updatedAt,
    });
    expect(repository.changePlanStatusWithAudit).not.toHaveBeenCalled();
  });

  it('answers the same status before the transition map (archived -> archived is not an error)', async () => {
    const result = await change(planRow({ status: 'ARCHIVED' }), 'ARCHIVED');
    expect(result.status).toBe('archived');
  });

  it('stores no reason as null in the audit', async () => {
    repository.changePlanStatusWithAudit.mockImplementation(async ({ auditFor }) => {
      repository.lastAudit = auditFor();
      return planRow({ status: 'INACTIVE' });
    });

    await change(planRow(), 'INACTIVE');

    expect(repository.lastAudit.details.reason).toBeNull();
  });

  describe('restoring an archived plan', () => {
    it('is 409 PLAN_DUPLICATE_NAME when a non-archived plan took the name, before any write', async () => {
      repository.findActiveByName.mockResolvedValue(planRow({ id: 'other', status: 'ACTIVE' }));

      const err = await errorOf(change(planRow({ status: 'ARCHIVED' }), 'INACTIVE'));

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_DUPLICATE_NAME' });
      expect(repository.findActiveByName).toHaveBeenCalledWith('Gold Class', undefined, {
        excludeId: 'plan-1',
      });
      expect(repository.changePlanStatusWithAudit).not.toHaveBeenCalled();
    });

    it('restores when the name is free', async () => {
      repository.changePlanStatusWithAudit.mockResolvedValue(planRow({ status: 'INACTIVE' }));

      const result = await change(planRow({ status: 'ARCHIVED' }), 'INACTIVE');

      expect(result.status).toBe('inactive');
    });

    it('does not check the name for other moves', async () => {
      repository.changePlanStatusWithAudit.mockResolvedValue(planRow({ status: 'INACTIVE' }));
      await change(planRow({ status: 'ACTIVE' }), 'INACTIVE');
      expect(repository.findActiveByName).not.toHaveBeenCalled();
    });

    it('maps a unique-index race to 409 PLAN_DUPLICATE_NAME', async () => {
      repository.changePlanStatusWithAudit.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      const err = await errorOf(change(planRow({ status: 'ARCHIVED' }), 'INACTIVE'));

      expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_DUPLICATE_NAME' });
    });
  });

  it('is 409 PLAN_INVALID_TRANSITION when the status changed between the read and the write', async () => {
    repository.changePlanStatusWithAudit.mockResolvedValue(null);

    const err = await errorOf(change(planRow(), 'INACTIVE'));

    expect(err).toMatchObject({ statusCode: 409, code: 'PLAN_INVALID_TRANSITION' });
  });
});
