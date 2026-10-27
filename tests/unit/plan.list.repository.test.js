const prisma = require('../../src/config/prisma');
const {
  buildListWhere,
  listPlans,
  countNonArchivedByCreditType,
} = require('../../src/repositories/membershipPlan.repository');

jest.mock('../../src/config/prisma', () => ({
  membershipPlan: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
}));

const conditionsOf = (filters) => buildListWhere(filters).AND;

describe('buildListWhere', () => {
  it('shows only active and inactive plans by default', () => {
    expect(conditionsOf({})).toEqual([{ status: { in: ['ACTIVE', 'INACTIVE'] } }]);
  });

  it('returns archived plans only when the status asks for them', () => {
    expect(conditionsOf({ status: ['ARCHIVED'] })).toEqual([{ status: { in: ['ARCHIVED'] } }]);
  });

  it('maps the sections onto the credit type', () => {
    expect(conditionsOf({ section: 'online_coaching' })).toContainEqual({ creditType: 'TIME' });
    expect(conditionsOf({ section: 'class_membership' })).toContainEqual({
      creditType: { not: 'TIME' },
    });
  });

  it('combines section and creditType with AND', () => {
    const conditions = conditionsOf({ section: 'online_coaching', creditType: 'CLASS' });
    expect(conditions).toContainEqual({ creditType: 'TIME' });
    expect(conditions).toContainEqual({ creditType: 'CLASS' });
  });

  it('adds the exact-match filters', () => {
    const conditions = conditionsOf({ kind: 'TRIAL', visibility: 'HIDDEN' });
    expect(conditions).toContainEqual({ kind: 'TRIAL' });
    expect(conditions).toContainEqual({ visibility: 'HIDDEN' });
  });

  it('searches name, description and the kind label, case-insensitively', () => {
    const search = conditionsOf({ q: 'trial' })[1];
    expect(search.OR).toEqual([
      { name: { contains: 'trial', mode: 'insensitive' } },
      { description: { contains: 'trial', mode: 'insensitive' } },
      { kind: { in: ['TRIAL'] } },
    ]);
  });

  it('matches several kinds by label and skips the kind clause when none match', () => {
    expect(conditionsOf({ q: 'I' })[1].OR[2]).toEqual({
      kind: { in: ['SUBSCRIPTION', 'CREDIT_PACK', 'SINGLE_VISIT', 'TRIAL'] },
    });
    expect(conditionsOf({ q: 'pack' })[1].OR[2]).toEqual({ kind: { in: ['CREDIT_PACK'] } });
    expect(conditionsOf({ q: 'nutrition' })[1].OR).toHaveLength(2);
  });

  it('escapes LIKE wildcards in the search text', () => {
    expect(conditionsOf({ q: '50%' })[1].OR[0].name.contains).toBe('50\\%');
  });
});

describe('listPlans', () => {
  beforeEach(() => jest.resetAllMocks());

  it('orders by a column with Prisma and counts with the same where', async () => {
    prisma.membershipPlan.findMany.mockResolvedValue([{ id: 'a' }]);
    prisma.membershipPlan.count.mockResolvedValue(1);

    const result = await listPlans({
      filters: { section: 'online_coaching' },
      sort: { field: 'price', direction: 'desc' },
      skip: 10,
      take: 5,
    });

    const where = buildListWhere({ section: 'online_coaching' });
    expect(prisma.membershipPlan.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ price: 'desc' }, { id: 'asc' }],
      skip: 10,
      take: 5,
      include: { membership: true },
    });
    expect(prisma.membershipPlan.count).toHaveBeenCalledWith({ where });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [{ id: 'a' }], total: 1 });
  });

  describe('sorting by name', () => {
    const sort = { field: 'name', direction: 'asc' };

    it('filters with Prisma, orders the ids in SQL and returns the rows in that order', async () => {
      prisma.membershipPlan.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      prisma.$queryRaw.mockResolvedValue([{ id: 'c' }, { id: 'a' }]);

      const result = await listPlans({ filters: { q: 'x' }, sort, skip: 0, take: 2 });

      expect(prisma.membershipPlan.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.membershipPlan.findMany).toHaveBeenCalledWith({
        where: buildListWhere({ q: 'x' }),
        include: { membership: true },
      });
      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('"membership_plans"');
      expect(sql).toContain('LOWER("name")');
      expect(prisma.$queryRaw.mock.calls[0][1]).toEqual(['a', 'b', 'c']);
      expect(result).toEqual({ rows: [{ id: 'c' }, { id: 'a' }], total: 3 });
    });

    it('uses DESC for a descending name sort', async () => {
      prisma.membershipPlan.findMany.mockResolvedValue([{ id: 'a' }]);
      prisma.$queryRaw.mockResolvedValue([{ id: 'a' }]);

      await listPlans({
        filters: {},
        sort: { field: 'name', direction: 'desc' },
        skip: 0,
        take: 5,
      });

      expect(prisma.$queryRaw.mock.calls[0][2].strings.join('')).toBe('DESC');
    });

    it('skips the SQL when no plan matches', async () => {
      prisma.membershipPlan.findMany.mockResolvedValue([]);

      const result = await listPlans({ filters: {}, sort, skip: 0, take: 20 });

      expect(result).toEqual({ rows: [], total: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns an empty page with the real total when the page is past the end', async () => {
      prisma.membershipPlan.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const result = await listPlans({ filters: {}, sort, skip: 40, take: 20 });

      expect(result).toEqual({ rows: [], total: 2 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});

describe('countNonArchivedByCreditType', () => {
  it('groups non-archived plans by credit type and takes no filter', async () => {
    prisma.membershipPlan.groupBy.mockResolvedValue([]);

    await countNonArchivedByCreditType();

    expect(prisma.membershipPlan.groupBy).toHaveBeenCalledWith({
      by: ['creditType'],
      where: { status: { not: 'ARCHIVED' } },
      _count: { _all: true },
    });
  });
});
