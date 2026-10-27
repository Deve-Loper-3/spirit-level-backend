const prisma = require('../../src/config/prisma');
const { runDailyGeneration } = require('../../src/services/schedule.job');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { addDaysToDateStr, getTodayInTimezone } = require('../../src/services/schedule.service');

jest.setTimeout(45000);

describe('Schedule Job Integration Tests (Idempotent Daily Generation)', () => {
  const PREFIX = 'test_job_';
  let testClass;

  beforeAll(async () => {
    await deleteTestClasses(PREFIX);

    testClass = await createTestClass(PREFIX, {
      name: `${PREFIX}DailyJobClass`,
      durationMin: 60,
      baseCapacity: 10,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });

    const todayStr = getTodayInTimezone('Asia/Dubai');
    const tomorrowStr = addDaysToDateStr(todayStr, 1);

    await prisma.classSlot.create({
      data: {
        id: 'slot-job-' + Date.now(),
        classId: testClass.id,
        dayOfWeek: 2, // Tuesday
        startDate: new Date(tomorrowStr + 'T00:00:00.000Z'),
        startTime: new Date('1970-01-01T07:00:00.000Z'),
        endTime: new Date('1970-01-01T08:00:00.000Z'),
        capacity: 10,
        active: true,
      },
    });
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX);
    await prisma.$disconnect();
  });

  it('runs daily generation first time and generates sessions', async () => {
    const firstRun = await runDailyGeneration({ classId: testClass.id });
    expect(firstRun.error).toBeUndefined();
    expect(firstRun.totalGenerated).toBeGreaterThanOrEqual(1);

    const countAfterFirst = await prisma.classSession.count({
      where: { classId: testClass.id },
    });
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Second run must be completely idempotent: 0 new sessions generated for this class
    const secondRun = await runDailyGeneration({ classId: testClass.id });
    expect(secondRun.error).toBeUndefined();
    expect(secondRun.totalGenerated).toBe(0);

    const countAfterSecond = await prisma.classSession.count({
      where: { classId: testClass.id },
    });
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
