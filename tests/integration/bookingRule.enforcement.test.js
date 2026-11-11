const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');
const { BookingRuleKey } = require('../../src/constants/bookingRule');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestClasses,
  createTestClass,
  createTestSession,
} = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');
const {
  snapshotBookingRules,
  restoreBookingRules,
  setTestRule,
  removeTestRule,
} = require('../helpers/bookingRule.helper');

jest.setTimeout(60000);

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY);

describe('Booking rules enforced in existing APIs', () => {
  const PREFIX = 'test_brenf_';
  const testData = createTestData('brenf');
  let app;
  let snapshot;
  let admin;
  let owner;
  let coach;
  let member;
  let plan;

  const as = (user) => ({ Authorization: bearerFor(user) });

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    snapshot = await snapshotBookingRules();
    await cleanup();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coach = await testData.createUser({ role: Role.COACH });
    member = await testData.createUser({ role: Role.MEMBER });
    plan = await createTestPlan(PREFIX, { name: `${PREFIX}Plan` });
  });

  afterAll(async () => {
    await cleanup();
    await restoreBookingRules(snapshot);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('member timetable (TIMETABLE_VISIBLE_AHEAD)', () => {
    let timetableClass;
    let soon;
    let later;
    let far;

    const rangeQuery = (fromDays, toDays) =>
      `from=${inDays(fromDays).toISOString()}&to=${inDays(toDays).toISOString()}`;
    // Only this test's own class is listed (classId filter), so sessions already in the database
    // can neither appear in the result nor push these three off the first page.
    const idsFor = async (user, fromDays = 0, toDays = 60) => {
      const res = await request(app)
        .get(
          `/api/v1/sessions?${rangeQuery(fromDays, toDays)}&classId=${timetableClass.id}&limit=100`,
        )
        .set(as(user));
      expect(res.status).toBe(200);
      return res.body.data.map((s) => s.id);
    };

    beforeAll(async () => {
      timetableClass = await createTestClass(PREFIX, {
        name: `${PREFIX}Timetable`,
        visibility: 'PUBLIC',
        status: 'ACTIVE',
      });
      soon = await createTestSession(timetableClass.id, { startAt: inDays(2) });
      later = await createTestSession(timetableClass.id, { startAt: inDays(10) });
      far = await createTestSession(timetableClass.id, { startAt: inDays(30) });
    });

    beforeEach(async () => {
      await setTestRule(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD);
    });

    it('shows a member the sessions within 21 days and hides the later ones', async () => {
      expect(await idsFor(member)).toEqual([soon.id, later.id]);
    });

    it.each([
      ['admin', () => admin],
      ['owner', () => owner],
      ['coach', () => coach],
    ])('does not cap a %s', async (_name, getUser) => {
      expect(await idsFor(getUser())).toEqual([soon.id, later.id, far.id]);
    });

    it('answers an empty page when the member asks only for dates beyond the limit', async () => {
      const res = await request(app)
        .get(`/api/v1/sessions?${rangeQuery(25, 40)}`)
        .set(as(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 0 });
    });

    it('applies a changed value at once, to sessions that already exist', async () => {
      await setTestRule(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD, { value: 5 });
      expect(await idsFor(member)).toEqual([soon.id]);

      await setTestRule(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD, { value: 40 });
      expect(await idsFor(member)).toEqual([soon.id, later.id, far.id]);
    });

    it('applies no cap when the rule is disabled', async () => {
      await setTestRule(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD, { enabled: false });
      expect(await idsFor(member)).toEqual([soon.id, later.id, far.id]);
    });

    it('applies no cap and no default when the rule is deleted', async () => {
      await removeTestRule(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD);
      expect(await idsFor(member)).toEqual([soon.id, later.id, far.id]);
    });
  });

  describe('ClassPass accept (CLASSPASS_ACCEPT)', () => {
    const classPayload = (overrides = {}) => ({
      name: `${PREFIX}Class_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      description: 'A test class',
      durationMin: 60,
      baseCapacity: 20,
      intensity: 3,
      visibility: 'public',
      classPassEnabled: true,
      classpassSpots: 2,
      colour: '#112233',
      photoUrl: 'https://example.com/class.png',
      eligiblePlanIds: [plan.id],
      ...overrides,
    });
    const createViaApi = (user, payload) =>
      request(app).post('/api/v1/classes').set(as(user)).send(payload);
    const patchViaApi = (user, classId, body) =>
      request(app).patch(`/api/v1/classes/${classId}`).set(as(user)).send(body);
    const classNamed = (name) => prisma.class.findFirst({ where: { name } });
    const normalClass = () =>
      createTestClass(PREFIX, { classPassEnabled: false, classpassSpots: 0 });
    const classPassClass = () =>
      createTestClass(PREFIX, { classPassEnabled: true, classpassSpots: 2 });
    const accept = (overrides) => setTestRule(BookingRuleKey.CLASSPASS_ACCEPT, overrides);

    describe('POST /classes', () => {
      it.each([
        ['admin', () => admin],
        ['owner', () => owner],
      ])('lets an %s create a ClassPass class while the rule is on', async (_name, getUser) => {
        await accept({ enabled: true });

        const res = await createViaApi(getUser(), classPayload());

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ classPassEnabled: true, classpassSpots: 2 });
      });

      it('answers 409 CLASSPASS_NOT_ACCEPTED while the rule is off, and creates nothing', async () => {
        await accept({ enabled: false });
        const payload = classPayload();

        const res = await createViaApi(admin, payload);

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          success: false,
          code: 'CLASSPASS_NOT_ACCEPTED',
          message: Messages.CLASSPASS_NOT_ACCEPTED,
        });
        expect(await classNamed(payload.name)).toBeNull();
      });

      it('answers 409 when the rule is deleted (no default)', async () => {
        await removeTestRule(BookingRuleKey.CLASSPASS_ACCEPT);
        const res = await createViaApi(admin, classPayload());
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CLASSPASS_NOT_ACCEPTED');
      });

      it('still creates a class without ClassPass while the rule is off', async () => {
        await accept({ enabled: false });
        const res = await createViaApi(
          admin,
          classPayload({ classPassEnabled: false, classpassSpots: 0 }),
        );
        expect(res.status).toBe(201);
        expect(res.body.data.classPassEnabled).toBe(false);
      });

      it('follows the rule as it changes between two requests', async () => {
        await accept({ enabled: true });
        expect((await createViaApi(admin, classPayload())).status).toBe(201);
        await accept({ enabled: false });
        expect((await createViaApi(admin, classPayload())).status).toBe(409);
      });

      it('reports a validation error (400) before the ClassPass conflict', async () => {
        await accept({ enabled: false });
        const res = await createViaApi(admin, classPayload({ classpassSpots: 99 }));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('PATCH /classes/:id', () => {
      it('switches a normal class to ClassPass while the rule is on', async () => {
        await accept({ enabled: true });
        const target = await normalClass();

        const res = await patchViaApi(admin, target.id, { classPassEnabled: true });

        expect(res.status).toBe(200);
        expect((await prisma.class.findUnique({ where: { id: target.id } })).classPassEnabled).toBe(
          true,
        );
      });

      it('answers 409 and changes nothing when switching to ClassPass while the rule is off', async () => {
        await accept({ enabled: false });
        const target = await normalClass();

        const res = await patchViaApi(admin, target.id, { classPassEnabled: true });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CLASSPASS_NOT_ACCEPTED');
        expect((await prisma.class.findUnique({ where: { id: target.id } })).classPassEnabled).toBe(
          false,
        );
      });

      it('answers 409 when switching to ClassPass and the rule is deleted', async () => {
        await removeTestRule(BookingRuleKey.CLASSPASS_ACCEPT);
        const target = await normalClass();
        const res = await patchViaApi(owner, target.id, { classPassEnabled: true });
        expect(res.status).toBe(409);
      });

      it('lets a class that already is ClassPass be edited while the rule is off', async () => {
        await accept({ enabled: false });
        const target = await classPassClass();

        const edit = await patchViaApi(admin, target.id, { description: 'Edited' });
        const resend = await patchViaApi(admin, target.id, { classPassEnabled: true });

        expect(edit.status).toBe(200);
        expect(resend.status).toBe(200);
        expect(resend.body.data.classPassEnabled).toBe(true);
      });

      it('always lets ClassPass be turned off', async () => {
        await accept({ enabled: false });
        const target = await classPassClass();

        const res = await patchViaApi(admin, target.id, {
          classPassEnabled: false,
          classpassSpots: 0,
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ classPassEnabled: false, classpassSpots: 0 });
      });

      it('does not need the rule for an edit that leaves ClassPass alone', async () => {
        await removeTestRule(BookingRuleKey.CLASSPASS_ACCEPT);
        const target = await normalClass();
        const res = await patchViaApi(admin, target.id, { description: 'Edited' });
        expect(res.status).toBe(200);
      });
    });
  });
});
