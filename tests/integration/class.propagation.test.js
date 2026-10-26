const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestClasses,
  createTestClass,
  createTestSession,
} = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(90000);

describe('Class Template Propagation to Future Sessions (Set-Based SQL)', () => {
  const PREFIX = 'test_slcls_prop_';
  const testData = createTestData('slcls_prop');
  let app;
  let adminUser;
  let plan;
  let templateClass;
  let pastSession;
  let cancelledSession;
  let capacityOverriddenSession;
  let durationOverriddenSession;
  let bothOverriddenSession;
  const futureInheritingSessions = [];

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
    await testData.cleanup();
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Prop Tester' });
    plan = await createTestPlan(PREFIX);

    // Create a class template with baseCapacity: 12 and durationMin: 60
    templateClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Template_Class`,
      baseCapacity: 12,
      durationMin: 60,
      classType: 'ONSITE',
      intensity: 3,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });
    await prisma.classEligiblePlan.create({
      data: { classId: templateClass.id, planId: plan.id },
    });

    const now = Date.now();

    // 1. Past session (startAt in the past) -> must NOT be updated
    const pastStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
    pastSession = await createTestSession(templateClass.id, {
      startAt: pastStart,
      endAt: new Date(pastStart.getTime() + 60 * 60 * 1000),
      capacity: 12,
      state: 'OPEN',
      overriddenFields: [],
    });

    // 2. Cancelled future session -> must NOT be updated
    const cancelledStart = new Date(now + 2 * 24 * 60 * 60 * 1000);
    cancelledSession = await createTestSession(templateClass.id, {
      startAt: cancelledStart,
      endAt: new Date(cancelledStart.getTime() + 60 * 60 * 1000),
      capacity: 12,
      state: 'CANCELLED',
      cancelReason: 'Weather',
      overriddenFields: [],
    });

    // 3. Future session with capacity overridden
    const capOverStart = new Date(now + 3 * 24 * 60 * 60 * 1000);
    capacityOverriddenSession = await createTestSession(templateClass.id, {
      startAt: capOverStart,
      endAt: new Date(capOverStart.getTime() + 60 * 60 * 1000),
      capacity: 99,
      state: 'OPEN',
      overriddenFields: ['capacity'],
    });

    // 4. Future session with duration overridden
    const durOverStart = new Date(now + 4 * 24 * 60 * 60 * 1000);
    durationOverriddenSession = await createTestSession(templateClass.id, {
      startAt: durOverStart,
      endAt: new Date(durOverStart.getTime() + 120 * 60 * 1000),
      capacity: 12,
      state: 'OPEN',
      overriddenFields: ['duration'],
    });

    // 5. Future session with both capacity & duration overridden
    const bothOverStart = new Date(now + 5 * 24 * 60 * 60 * 1000);
    bothOverriddenSession = await createTestSession(templateClass.id, {
      startAt: bothOverStart,
      endAt: new Date(bothOverStart.getTime() + 120 * 60 * 1000),
      capacity: 99,
      state: 'OPEN',
      overriddenFields: ['capacity', 'duration'],
    });

    // 6. Create 55 standard future sessions that inherit from template
    // (Requirement: test with at least 50 future sessions)
    const sessionData = [];
    for (let i = 1; i <= 55; i += 1) {
      const sessionStart = new Date(now + (10 + i) * 24 * 60 * 60 * 1000);
      sessionData.push({
        id: crypto.randomUUID(),
        classId: templateClass.id,
        startAt: sessionStart,
        endAt: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        capacity: 12,
        state: 'OPEN',
        overriddenFields: [],
      });
    }

    await prisma.classSession.createMany({
      data: sessionData,
    });

    futureInheritingSessions.push(...sessionData);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('updates capacity and duration across 50+ future sessions via set-based SQL, respecting overrides and state', async () => {
    // Current state check
    expect(futureInheritingSessions.length).toBe(55);

    // Call PATCH /classes/:id to change baseCapacity to 20 and durationMin to 90
    const res = await request(app)
      .patch(`/api/v1/classes/${templateClass.id}`)
      .set('Authorization', bearerFor(adminUser))
      .send({
        baseCapacity: 20,
        durationMin: 90,
        version: templateClass.version,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.baseCapacity).toBe(20);
    expect(res.body.data.durationMin).toBe(90);
    expect(res.body.data.version).toBe(templateClass.version + 1);

    // Verify all 55 future inheriting sessions have capacity=20 and duration=90 min
    const updatedSessions = await prisma.classSession.findMany({
      where: {
        id: { in: futureInheritingSessions.map((s) => s.id) },
      },
    });
    expect(updatedSessions.length).toBe(55);

    for (const session of updatedSessions) {
      expect(session.capacity).toBe(20);
      const expectedEnd = new Date(session.startAt.getTime() + 90 * 60 * 1000);
      expect(session.endAt.toISOString()).toBe(expectedEnd.toISOString());
    }

    // Verify past session was untouched
    const checkPast = await prisma.classSession.findUnique({
      where: { id: pastSession.id },
    });
    expect(checkPast.capacity).toBe(12);
    expect(checkPast.endAt.toISOString()).toBe(pastSession.endAt.toISOString());

    // Verify cancelled future session was untouched
    const checkCancelled = await prisma.classSession.findUnique({
      where: { id: cancelledSession.id },
    });
    expect(checkCancelled.capacity).toBe(12);
    expect(checkCancelled.endAt.toISOString()).toBe(cancelledSession.endAt.toISOString());

    // Verify session with overridden capacity kept its capacity (99), but duration was updated to 90 min
    const checkCapOver = await prisma.classSession.findUnique({
      where: { id: capacityOverriddenSession.id },
    });
    expect(checkCapOver.capacity).toBe(99);
    const expectedCapOverEnd = new Date(checkCapOver.startAt.getTime() + 90 * 60 * 1000);
    expect(checkCapOver.endAt.toISOString()).toBe(expectedCapOverEnd.toISOString());

    // Verify session with overridden duration kept its duration (120 min), but capacity was updated to 20
    const checkDurOver = await prisma.classSession.findUnique({
      where: { id: durationOverriddenSession.id },
    });
    expect(checkDurOver.capacity).toBe(20);
    expect(checkDurOver.endAt.toISOString()).toBe(durationOverriddenSession.endAt.toISOString());

    // Verify session with both overridden kept both
    const checkBothOver = await prisma.classSession.findUnique({
      where: { id: bothOverriddenSession.id },
    });
    expect(checkBothOver.capacity).toBe(99);
    expect(checkBothOver.endAt.toISOString()).toBe(bothOverriddenSession.endAt.toISOString());
  });
});
