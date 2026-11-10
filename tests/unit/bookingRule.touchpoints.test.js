// The two places where a saved rule is already enforced: the ClassPass switch on a class and the
// member timetable. The rule reader is mocked, so no database is needed.
jest.mock('../../src/repositories/class.repository');
jest.mock('../../src/repositories/schedule.repository');
jest.mock('../../src/services/schedule.adapters');
jest.mock('../../src/services/bookingRule.service');

const classRepository = require('../../src/repositories/class.repository');
const scheduleRepository = require('../../src/repositories/schedule.repository');
const { isFeatureEnabled, getLimitValue } = require('../../src/services/bookingRule.service');
const { createClass, updateClass } = require('../../src/services/class.service');
const { listSessions } = require('../../src/services/schedule.service');
const { BookingRuleKey } = require('../../src/constants/bookingRule');
const { AppErrors } = require('../../src/constants/errors');
const { Role } = require('../../src/constants/roles');

const NOW = new Date('2026-11-10T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days) => new Date(NOW.getTime() + days * DAY);

describe('ClassPass accept rule on classes', () => {
  const stop = new Error('guard passed');
  const createPayload = (overrides = {}) => ({
    name: 'Hyrox Engine',
    visibility: 'PRIVATE',
    ...overrides,
  });
  const activeClass = (overrides = {}) => ({
    id: 'c1',
    status: 'ACTIVE',
    name: 'Hyrox Engine',
    version: 1,
    classPassEnabled: false,
    ...overrides,
  });

  beforeEach(() => {
    classRepository.findActiveByName.mockResolvedValue(null);
    classRepository.createClassWithPlans.mockRejectedValue(stop);
    classRepository.updateClass.mockRejectedValue(stop);
  });

  describe('createClass', () => {
    it('answers 409 CLASSPASS_NOT_ACCEPTED when the rule is off, and creates nothing', async () => {
      isFeatureEnabled.mockResolvedValue(false);

      await expect(
        createClass({ payload: createPayload({ classPassEnabled: true }) }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.CLASSPASS_NOT_ACCEPTED.code,
      });
      expect(isFeatureEnabled).toHaveBeenCalledWith(BookingRuleKey.CLASSPASS_ACCEPT);
      expect(classRepository.createClassWithPlans).not.toHaveBeenCalled();
    });

    it('goes on to create the class when the rule is on', async () => {
      isFeatureEnabled.mockResolvedValue(true);
      await expect(
        createClass({ payload: createPayload({ classPassEnabled: true }) }),
      ).rejects.toBe(stop);
      expect(classRepository.createClassWithPlans).toHaveBeenCalled();
    });

    it.each([[false], [undefined]])(
      'does not look at the rule when classPassEnabled is %s',
      async (classPassEnabled) => {
        await expect(createClass({ payload: createPayload({ classPassEnabled }) })).rejects.toBe(
          stop,
        );
        expect(isFeatureEnabled).not.toHaveBeenCalled();
      },
    );
  });

  describe('updateClass', () => {
    it('answers 409 when switching a normal class to ClassPass while the rule is off', async () => {
      isFeatureEnabled.mockResolvedValue(false);

      await expect(
        updateClass({ classRecord: activeClass(), payload: { classPassEnabled: true } }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'CLASSPASS_NOT_ACCEPTED' });
      expect(classRepository.updateClass).not.toHaveBeenCalled();
    });

    it('allows the switch while the rule is on', async () => {
      isFeatureEnabled.mockResolvedValue(true);
      await expect(
        updateClass({ classRecord: activeClass(), payload: { classPassEnabled: true } }),
      ).rejects.toBe(stop);
    });

    it('lets a class that is already ClassPass keep it while the rule is off', async () => {
      await expect(
        updateClass({
          classRecord: activeClass({ classPassEnabled: true }),
          payload: { classPassEnabled: true, description: 'new' },
        }),
      ).rejects.toBe(stop);
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });

    it('always lets ClassPass be turned off', async () => {
      await expect(
        updateClass({
          classRecord: activeClass({ classPassEnabled: true }),
          payload: { classPassEnabled: false },
        }),
      ).rejects.toBe(stop);
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });

    it('does not look at the rule when ClassPass is not part of the change', async () => {
      await expect(
        updateClass({ classRecord: activeClass(), payload: { description: 'new' } }),
      ).rejects.toBe(stop);
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });
  });
});

describe('member timetable visibility rule on listSessions', () => {
  const query = (fromDays, toDays) => ({
    from: inDays(fromDays).toISOString(),
    to: inDays(toDays).toISOString(),
  });
  const list = (role, q) => listSessions({ user: { id: 'u1', role }, query: q });
  const rangeUsed = () => {
    const { from, to } = scheduleRepository.findSessions.mock.calls[0][0];
    return { from, to };
  };

  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    scheduleRepository.findSessions.mockResolvedValue({ sessions: [] });
  });

  it('cuts the end of a member range at the visible limit', async () => {
    getLimitValue.mockResolvedValue(21);

    await list(Role.MEMBER, query(2, 60));

    expect(getLimitValue).toHaveBeenCalledWith(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD);
    expect(rangeUsed()).toEqual({ from: inDays(2), to: inDays(21) });
  });

  it('leaves a member range that is inside the limit alone', async () => {
    getLimitValue.mockResolvedValue(21);
    await list(Role.MEMBER, query(2, 10));
    expect(rangeUsed()).toEqual({ from: inDays(2), to: inDays(10) });
  });

  it('returns an empty page without a query when the member range is wholly beyond the limit', async () => {
    getLimitValue.mockResolvedValue(21);

    const result = await list(Role.MEMBER, query(30, 40));

    expect(scheduleRepository.findSessions).not.toHaveBeenCalled();
    expect(result.sessions).toEqual([]);
    expect(result.pagination).toMatchObject({ page: 1, limit: 20, total: 0 });
  });

  it('follows the saved value, so a change applies at once', async () => {
    getLimitValue.mockResolvedValue(5);
    await list(Role.MEMBER, query(0, 60));
    expect(rangeUsed().to).toEqual(inDays(5));
  });

  it('applies no cap when the rule is off or deleted', async () => {
    getLimitValue.mockResolvedValue(null);
    await list(Role.MEMBER, query(100, 150));
    expect(rangeUsed()).toEqual({ from: inDays(100), to: inDays(150) });
  });

  it.each([[Role.ADMIN], [Role.OWNER], [Role.COACH]])(
    'does not cap or even read the rule for a %s',
    async (role) => {
      getLimitValue.mockResolvedValue(21);

      await list(role, query(2, 60));

      expect(getLimitValue).not.toHaveBeenCalled();
      expect(rangeUsed()).toEqual({ from: inDays(2), to: inDays(60) });
    },
  );
});
