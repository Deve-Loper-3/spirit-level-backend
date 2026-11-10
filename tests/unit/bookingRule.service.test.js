jest.mock('../../src/repositories/bookingRule.repository');

const repository = require('../../src/repositories/bookingRule.repository');
const service = require('../../src/services/bookingRule.service');
const { AppErrors } = require('../../src/constants/errors');
const { AuditAction } = require('../../src/constants/audit');

const actor = { id: 'owner-1', role: 'OWNER', email: 'owner@test.invalid' };
const meta = { ipAddress: '1.2.3.4', userAgent: 'jest' };
const now = new Date('2026-11-10T08:00:00.000Z');

const rule = (overrides = {}) => ({
  id: 'rule-1',
  ruleKey: 'WAITLIST_MAX_PER_CLASS',
  category: 'WAITLIST_GUESTS_CAPACITY',
  name: 'Waitlist size per class',
  value: 4,
  unit: 'COUNT',
  enabled: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const prismaError = (code) => Object.assign(new Error(code), { code });

describe('reading rules', () => {
  it('getRule returns the saved row or null', async () => {
    repository.findByRuleKey.mockResolvedValueOnce(rule());
    expect(await service.getRule('WAITLIST_MAX_PER_CLASS')).toMatchObject({ value: 4 });
    repository.findByRuleKey.mockResolvedValueOnce(null);
    expect(await service.getRule('WAITLIST_MAX_PER_CLASS')).toBeNull();
  });

  describe('isFeatureEnabled', () => {
    it('is true only for a saved, enabled rule', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(rule({ enabled: true }));
      expect(await service.isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(true);
    });

    it('is false for a disabled rule', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(rule({ enabled: false }));
      expect(await service.isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(false);
    });

    it('is false for a deleted rule (no fallback default)', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(null);
      expect(await service.isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(false);
    });
  });

  describe('getLimitValue', () => {
    it('returns the value of an enabled rule', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(rule({ value: 6 }));
      expect(await service.getLimitValue('WAITLIST_MAX_PER_CLASS')).toBe(6);
    });

    it('returns null (no restriction) for a disabled rule', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(rule({ enabled: false }));
      expect(await service.getLimitValue('WAITLIST_MAX_PER_CLASS')).toBeNull();
    });

    it('returns null (no restriction) for a deleted rule', async () => {
      repository.findByRuleKey.mockResolvedValueOnce(null);
      expect(await service.getLimitValue('WAITLIST_MAX_PER_CLASS')).toBeNull();
    });
  });
});

describe('createBookingRule', () => {
  const saved = (data) => ({ id: 'new-id', createdAt: now, updatedAt: now, ...data });

  it('uses the catalogue defaults when value and enabled are not sent', async () => {
    repository.createRuleWithAudit.mockImplementation(async ({ data }) => saved(data));

    const result = await service.createBookingRule({
      actor,
      payload: { ruleKey: 'LATE_FEE' },
      meta,
    });

    expect(repository.createRuleWithAudit.mock.calls[0][0].data).toEqual({
      ruleKey: 'LATE_FEE',
      category: 'CANCELLATIONS',
      name: 'Late cancellation fee (% of class fee)',
      value: 10,
      unit: 'PERCENT',
      enabled: false,
    });
    expect(result).toMatchObject({
      ruleKey: 'LATE_FEE',
      unit: 'percent',
      value: 10,
      enabled: false,
    });
  });

  it('uses the sent value and enabled', async () => {
    repository.createRuleWithAudit.mockImplementation(async ({ data }) => saved(data));
    await service.createBookingRule({
      actor,
      payload: { ruleKey: 'MAX_CLASSES_PER_WEEK', value: 5, enabled: true },
      meta,
    });
    expect(repository.createRuleWithAudit.mock.calls[0][0].data).toMatchObject({
      value: 5,
      enabled: true,
    });
  });

  it.each([
    ['CLASSPASS_ACCEPT', true],
    ['CLIENT_SELF_PAUSE', false],
  ])(
    'creates the flag rule %s with null value and unit, default enabled=%s',
    async (ruleKey, enabled) => {
      repository.createRuleWithAudit.mockImplementation(async ({ data }) => saved(data));
      await service.createBookingRule({ actor, payload: { ruleKey }, meta });
      expect(repository.createRuleWithAudit.mock.calls[0][0].data).toMatchObject({
        value: null,
        unit: null,
        enabled,
      });
    },
  );

  it('builds a BOOKING_RULE_CREATED audit entry for the actor', async () => {
    repository.createRuleWithAudit.mockImplementation(async ({ data }) => saved(data));
    await service.createBookingRule({ actor, payload: { ruleKey: 'LATE_FEE' }, meta });

    const { auditFor } = repository.createRuleWithAudit.mock.calls[0][0];
    expect(auditFor(saved({ ruleKey: 'LATE_FEE', value: 10, enabled: false }))).toMatchObject({
      action: AuditAction.BOOKING_RULE_CREATED,
      actorId: 'owner-1',
      actorRole: 'OWNER',
      email: 'owner@test.invalid',
      meta,
      details: { ruleKey: 'LATE_FEE', value: 10, enabled: false },
    });
  });

  it('turns a unique violation into 409 BOOKING_RULE_ALREADY_EXISTS', async () => {
    repository.createRuleWithAudit.mockRejectedValue(prismaError('P2002'));
    await expect(
      service.createBookingRule({ actor, payload: { ruleKey: 'LATE_FEE' }, meta }),
    ).rejects.toMatchObject({ statusCode: 409, code: AppErrors.BOOKING_RULE_ALREADY_EXISTS.code });
  });

  it('passes other errors through', async () => {
    repository.createRuleWithAudit.mockRejectedValue(new Error('db down'));
    await expect(
      service.createBookingRule({ actor, payload: { ruleKey: 'LATE_FEE' }, meta }),
    ).rejects.toThrow('db down');
  });
});

describe('updateBookingRule', () => {
  it('404s when the rule does not exist', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(
      service.updateBookingRule({ actor, id: 'x', changes: { enabled: true }, meta }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'BOOKING_RULE_NOT_FOUND' });
    expect(repository.updateRuleWithAudit).not.toHaveBeenCalled();
  });

  it('rejects a value outside the unit bounds with field value', async () => {
    repository.findById.mockResolvedValue(rule({ unit: 'COUNT' }));
    await expect(
      service.updateBookingRule({ actor, id: 'rule-1', changes: { value: 1001 }, meta }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: [{ field: 'value' }],
    });
  });

  it('rejects a value for a flag rule', async () => {
    repository.findById.mockResolvedValue(rule({ unit: null, value: null }));
    await expect(
      service.updateBookingRule({ actor, id: 'rule-1', changes: { value: 1 }, meta }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('writes only the changed fields and audits the diff', async () => {
    repository.findById.mockResolvedValue(rule({ value: 4, enabled: true }));
    repository.updateRuleWithAudit.mockImplementation(async ({ data }) => rule(data));

    const result = await service.updateBookingRule({
      actor,
      id: 'rule-1',
      changes: { value: 6, enabled: true },
      meta,
    });

    const call = repository.updateRuleWithAudit.mock.calls[0][0];
    expect(call.data).toEqual({ value: 6, enabled: true });
    expect(call.auditFor(rule({ value: 6 }))).toMatchObject({
      action: AuditAction.BOOKING_RULE_UPDATED,
      details: { ruleKey: 'WAITLIST_MAX_PER_CLASS', changes: { value: { from: 4, to: 6 } } },
    });
    expect(result.value).toBe(6);
  });

  it('writes nothing when the values are already what was sent', async () => {
    repository.findById.mockResolvedValue(rule({ value: 4, enabled: true }));
    const result = await service.updateBookingRule({
      actor,
      id: 'rule-1',
      changes: { value: 4, enabled: true },
      meta,
    });
    expect(repository.updateRuleWithAudit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'rule-1', value: 4 });
  });

  it('answers 404 when the rule is deleted between the read and the write', async () => {
    repository.findById.mockResolvedValue(rule());
    repository.updateRuleWithAudit.mockRejectedValue(prismaError('P2025'));
    await expect(
      service.updateBookingRule({ actor, id: 'rule-1', changes: { enabled: false }, meta }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'BOOKING_RULE_NOT_FOUND' });
  });
});

describe('deleteBookingRule', () => {
  it('404s when the rule does not exist', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.deleteBookingRule({ actor, id: 'x', meta })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repository.deleteRuleWithAudit).not.toHaveBeenCalled();
  });

  it('deletes and audits BOOKING_RULE_DELETED', async () => {
    repository.findById.mockResolvedValue(rule());
    repository.deleteRuleWithAudit.mockResolvedValue(rule());

    await service.deleteBookingRule({ actor, id: 'rule-1', meta });

    const call = repository.deleteRuleWithAudit.mock.calls[0][0];
    expect(call.id).toBe('rule-1');
    expect(call.auditFor(rule())).toMatchObject({
      action: AuditAction.BOOKING_RULE_DELETED,
      details: { ruleKey: 'WAITLIST_MAX_PER_CLASS', value: 4, enabled: true },
    });
  });

  it('answers 404 when the rule is already gone at write time', async () => {
    repository.findById.mockResolvedValue(rule());
    repository.deleteRuleWithAudit.mockRejectedValue(prismaError('P2025'));
    await expect(service.deleteBookingRule({ actor, id: 'rule-1', meta })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
