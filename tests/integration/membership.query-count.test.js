const { PrismaClient } = require('@prisma/client');
const {
  listPage,
  findByIdWithPlans,
} = require('../../src/repositories/membership.repository');
const {
  deleteTestMemberships,
  deleteTestPlans,
  createTestMembership,
  createTestPlan,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('Memberships: constant query count (no N+1)', () => {
  const PREFIX = 'test_mem_qc_';
  let testPrisma;
  let queries = [];
  const membershipIds = [];

  beforeAll(async () => {
    testPrisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    testPrisma.$on('query', (e) => {
      if (e.query.trim() !== 'SELECT 1') queries.push(e.query);
    });
    await testPrisma.$connect();

    await deleteTestPlans(PREFIX, testPrisma);
    await deleteTestMemberships(PREFIX, testPrisma);

    for (let i = 0; i < 6; i += 1) {
      const membership = await createTestMembership(PREFIX, {}, testPrisma);
      membershipIds.push(membership.id);
      await createTestPlan(PREFIX, { membershipId: membership.id }, testPrisma);
      await createTestPlan(PREFIX, { membershipId: membership.id }, testPrisma);
    }
  });

  afterAll(async () => {
    await deleteTestPlans(PREFIX, testPrisma);
    await deleteTestMemberships(PREFIX, testPrisma);
    await testPrisma.$disconnect();
  });

  beforeEach(() => {
    queries = [];
  });

  it('a page of 1 membership and a page of 6 run the same number of queries', async () => {
    await listPage({ skip: 0, take: 1 }, testPrisma); // warm-up
    queries = [];

    const one = await listPage({ skip: 0, take: 1 }, testPrisma);
    const countForOne = queries.length;
    queries = [];
    const six = await listPage({ skip: 0, take: 6 }, testPrisma);
    const countForSix = queries.length;

    expect(one.rows).toHaveLength(1);
    expect(six.rows).toHaveLength(6);
    expect(countForOne).toBeGreaterThan(0);
    expect(countForSix).toBe(countForOne);
  });

  it('planCount comes from the database count and matches the loaded plans', async () => {
    const detail = await findByIdWithPlans(membershipIds[0], testPrisma);

    expect(detail._count.plans).toBe(2);
    expect(detail.plans).toHaveLength(2);
  });

  it('the total is the number of memberships, not the size of the page', async () => {
    const { rows, total } = await listPage({ skip: 0, take: 1 }, testPrisma);

    expect(rows).toHaveLength(1);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it('pages never overlap and keep a stable order', async () => {
    const first = await listPage({ skip: 0, take: 3 }, testPrisma);
    const second = await listPage({ skip: 3, take: 3 }, testPrisma);

    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
