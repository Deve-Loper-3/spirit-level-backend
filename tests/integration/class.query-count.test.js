const { PrismaClient } = require('@prisma/client');
const { listClasses, findById } = require('../../src/repositories/class.repository');
const { createTestData } = require('../helpers/testData.helper');
const {
  deleteTestClasses,
  createTestClass,
  linkTestClassCoach,
  createTestSlot,
  createTestSession,
} = require('../helpers/class.helper');

jest.setTimeout(45000);

describe('Batch Loading & Constant Query Count (No N+1)', () => {
  const PREFIX = 'test_slcls_qc_';
  const testData = createTestData('slcls_qc');
  let testPrisma;
  let queries = [];
  let coach1;
  let coach2;
  const createdClassIds = [];

  beforeAll(async () => {
    testPrisma = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    testPrisma.$on('query', (e) => {
      if (e.query.trim() !== 'SELECT 1') {
        queries.push(e.query);
      }
    });
    await testPrisma.$connect();

    await deleteTestClasses(PREFIX, testPrisma);

    // Create 2 coach profiles with users so coach->user loading is exercised
    const c1 = await testData.createCoach({ user: { fullName: 'QC Coach 1' } });
    const c2 = await testData.createCoach({ user: { fullName: 'QC Coach 2' } });
    coach1 = c1.coach;
    coach2 = c2.coach;

    // Create 12 test classes, each with coaches assigned, slots, and sessions
    for (let i = 1; i <= 12; i += 1) {
      const cls = await createTestClass(
        PREFIX,
        {
          name: `${PREFIX}Class_${i}_${Date.now()}`,
          baseCapacity: 15,
          durationMin: 60,
          classType: 'ONSITE',
          intensity: 3,
          visibility: 'PUBLIC',
          status: 'ACTIVE',
        },
        testPrisma,
      );
      createdClassIds.push(cls.id);

      // Assign coach1 to all, and coach2 to even-numbered classes
      await linkTestClassCoach(cls.id, coach1.id, testPrisma);
      if (i % 2 === 0) {
        await linkTestClassCoach(cls.id, coach2.id, testPrisma);
      }

      // Add a slot and session
      await createTestSlot(cls.id, {}, testPrisma);
      await createTestSession(cls.id, {}, testPrisma);
    }
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX, testPrisma);
    await testData.cleanup();
    await testPrisma.$disconnect();
  });

  beforeEach(() => {
    queries = [];
  });

  it('proves constant query count on list: 1 class with coaches vs 12 classes with coaches executes identical queries', async () => {
    const where = { id: { in: createdClassIds } };

    // 1. Fetch exactly 1 class (with coaches & slots)
    queries = [];
    const res1 = await listClasses({ where, page: 1, pageSize: 1 }, testPrisma);
    expect(res1.classes.length).toBe(1);
    expect(res1.classes[0].coaches.length).toBeGreaterThanOrEqual(1);
    const countForOne = queries.length;

    // 2. Fetch 12 classes (with coaches & slots)
    queries = [];
    const res12 = await listClasses({ where, page: 1, pageSize: 12 }, testPrisma);
    expect(res12.classes.length).toBe(12);
    expect(res12.classes[1].coaches.length).toBeGreaterThanOrEqual(1);
    const countForTwelve = queries.length;

    // Queries executed must be strictly equal (1 findMany + relations batch loaded + 1 count)
    // No N+1 queries when classes increase from 1 to 12
    expect(countForOne).toBe(countForTwelve);
    expect(countForOne).toBeGreaterThan(0);
  });

  it('proves deterministic, constant query count on detail lookup with coach-assigned class', async () => {
    // Warm-up call (in case of lazy table/enum type initialization in Prisma client)
    await findById(createdClassIds[2], { isDetail: true }, testPrisma);

    queries = [];
    const detail = await findById(createdClassIds[0], { isDetail: true }, testPrisma);
    expect(detail).toBeDefined();
    expect(detail.coaches.length).toBeGreaterThanOrEqual(1);
    const detailQueryCount = queries.length;

    // Second call on a different class with multiple coaches
    queries = [];
    const detail2 = await findById(createdClassIds[1], { isDetail: true }, testPrisma);
    expect(detail2).toBeDefined();
    expect(detail2.coaches.length).toBeGreaterThanOrEqual(2);
    const detail2QueryCount = queries.length;

    // Both detail lookups issue the exact same deterministic query count (8 queries)
    expect(detailQueryCount).toBe(8);
    expect(detailQueryCount).toBe(detail2QueryCount);
  });
});
