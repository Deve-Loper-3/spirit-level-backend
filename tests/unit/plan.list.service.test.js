const { listPlans, toSectionCounts } = require('../../src/services/plan.service');
const repository = require('../../src/repositories/membershipPlan.repository');
const { PLAN_LIST_ITEM_FIELDS } = require('../../src/constants/membershipPlan');
const { toSection } = require('../../src/repositories/membershipPlan.mapper');

jest.mock('../../src/repositories/membershipPlan.repository');

const planRow = (overrides = {}) => ({
  id: 'plan-1',
  name: 'Nutrition Coaching',
  kind: 'SUBSCRIPTION',
  price: 1188,
  billingCycle: 'MONTH',
  creditType: 'TIME',
  creditsIncluded: 0,
  creditRefill: null,
  validityValue: 1,
  validityUnit: 'MONTH',
  startsOn: 'PURCHASE_DATE',
  oneTimePurchasePerClient: false,
  visibility: 'PUBLIC',
  status: 'ACTIVE',
  description: 'secret detail',
  version: 3,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  ...overrides,
});

const query = (overrides = {}) => ({
  page: 1,
  limit: 20,
  sort: { field: 'name', direction: 'asc' },
  ...overrides,
});

describe('toSection', () => {
  it('derives the section from the credit type', () => {
    expect(toSection('TIME')).toBe('online_coaching');
    expect(toSection('time')).toBe('online_coaching');
    ['CLASS', 'APPOINTMENT', 'FACILITY'].forEach((type) =>
      expect(toSection(type)).toBe('class_membership'),
    );
  });
});

describe('toSectionCounts', () => {
  it('folds credit-type groups into the two sections', () => {
    const groups = [
      { creditType: 'CLASS', _count: { _all: 31 } },
      { creditType: 'APPOINTMENT', _count: { _all: 9 } },
      { creditType: 'FACILITY', _count: { _all: 13 } },
      { creditType: 'TIME', _count: { _all: 7 } },
    ];
    expect(toSectionCounts(groups)).toEqual({ class_membership: 53, online_coaching: 7 });
  });

  it('keeps both sections, with 0, when a section is empty', () => {
    expect(toSectionCounts([])).toEqual({ class_membership: 0, online_coaching: 0 });
  });
});

describe('plan.service - listPlans', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    repository.countNonArchivedByCreditType.mockResolvedValue([
      { creditType: 'TIME', _count: { _all: 7 } },
      { creditType: 'CLASS', _count: { _all: 53 } },
    ]);
  });

  it('returns short-form items and the pagination and the counts', async () => {
    repository.listPlans.mockResolvedValue({ rows: [planRow()], total: 1 });

    const { plans, pagination, counts } = await listPlans({ query: query({ q: 'nutrition' }) });

    expect(Object.keys(plans[0]).sort()).toEqual([...PLAN_LIST_ITEM_FIELDS].sort());
    expect(plans[0]).toMatchObject({
      id: 'plan-1',
      section: 'online_coaching',
      kind: 'subscription',
      price: 1188,
      billingCycle: 'month',
      creditType: 'time',
      creditSummary: 'Time-based access',
      visibility: 'public',
      status: 'active',
      activeClientCount: 0,
    });
    expect(plans[0]).not.toHaveProperty('description');
    expect(pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(counts).toEqual({ class_membership: 53, online_coaching: 7 });
  });

  it('passes the filters, sort and skip/take to the repository, and no filter to the counts', async () => {
    repository.listPlans.mockResolvedValue({ rows: [], total: 0 });

    await listPlans({
      query: query({ page: 3, limit: 10, section: 'online_coaching', status: ['ARCHIVED'] }),
    });

    expect(repository.listPlans).toHaveBeenCalledWith({
      filters: { section: 'online_coaching', status: ['ARCHIVED'] },
      sort: { field: 'name', direction: 'asc' },
      skip: 20,
      take: 10,
    });
    expect(repository.countNonArchivedByCreditType).toHaveBeenCalledWith();
  });
});
