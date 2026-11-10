const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { createPlanLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestPlans,
  deleteTestMemberships,
  createTestMembership,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(35000);

describe('POST /api/v1/plans', () => {
  const TEST_PREFIX = 'test_slmp02_';
  const testData = createTestData('slmp02_plans');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
    await deleteTestMemberships(TEST_PREFIX);
    await prisma.auditLog.deleteMany({
      where: {
        reason: { startsWith: TEST_PREFIX },
      },
    });
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Tester' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Tester' });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const validPlanPayload = (overrides = {}) => ({
    name: `${TEST_PREFIX}Plan_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    kind: 'subscription',
    price: 150.0,
    billingCycle: 'month',
    creditType: 'class',
    creditsIncluded: 15,
    creditRefill: 'monthly',
    validityValue: 1,
    validityUnit: 'month',
    startsOn: 'purchase_date',
    oneTimePurchasePerClient: false,
    visibility: 'public',
    description: '15 classes a month',
    ...overrides,
  });

  describe('Authorization (401 / 403)', () => {
    it('returns 401 when request is unauthenticated', async () => {
      const res = await request(app).post('/api/v1/plans').send(validPlanPayload());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when caller is a COACH and creates nothing', async () => {
      const payload = validPlanPayload({ name: `${TEST_PREFIX}Coach_Forbidden` });
      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(coachUser))
        .send(payload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');

      const found = await prisma.membershipPlan.findFirst({ where: { name: payload.name } });
      expect(found).toBeNull();
    });

    it('returns 403 when caller is a MEMBER and creates nothing', async () => {
      const payload = validPlanPayload({ name: `${TEST_PREFIX}Member_Forbidden` });
      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(memberUser))
        .send(payload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');

      const found = await prisma.membershipPlan.findFirst({ where: { name: payload.name } });
      expect(found).toBeNull();
    });
  });

  describe('Validation errors (400 Unprocessable Entity)', () => {
    it('rejects time-based plan when creditsIncluded is 5', async () => {
      const payload = validPlanPayload({
        creditType: 'time',
        creditsIncluded: 5,
        creditRefill: null,
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      const err = res.body.errors.find((e) => e.field === 'creditsIncluded');
      expect(err).toBeDefined();
    });

    it('rejects class plan without creditsIncluded', async () => {
      const payload = validPlanPayload({ creditType: 'class' });
      delete payload.creditsIncluded;

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const err = res.body.errors.find((e) => e.field === 'creditsIncluded');
      expect(err).toBeDefined();
    });

    it('rejects credit_pack with month billingCycle with exact message: "Only a membership renews monthly."', async () => {
      const payload = validPlanPayload({
        kind: 'credit_pack',
        billingCycle: 'month',
        creditRefill: null,
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const err = res.body.errors.find((e) => e.field === 'billingCycle');
      expect(err).toBeDefined();
      expect(err.message).toBe('Only a membership renews monthly.');
    });

    it('rejects quarter billingCycle with monthly creditRefill', async () => {
      const payload = validPlanPayload({
        billingCycle: 'quarter',
        creditRefill: 'monthly',
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const err = res.body.errors.find((e) => e.field === 'creditRefill');
      expect(err).toBeDefined();
    });

    it('rejects negative or missing price with 400', async () => {
      const payload = validPlanPayload({ price: -10 });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const err = res.body.errors.find((e) => e.field === 'price');
      expect(err).toBeDefined();
    });

    it('rejects a single body with missing price, credit_pack/month, and time/creditsIncluded 5 with 400 listing all three fields together', async () => {
      const payload = {
        name: `${TEST_PREFIX}Combined_Errors`,
        kind: 'credit_pack',
        billingCycle: 'month',
        creditType: 'time',
        creditsIncluded: 5,
        creditRefill: null,
        validityValue: 1,
        validityUnit: 'month',
        startsOn: 'purchase_date',
        visibility: 'public',
      };

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      const fields = res.body.errors.map((e) => e.field);
      expect(fields.sort()).toEqual(['billingCycle', 'creditsIncluded', 'price'].sort());
      expect(fields).toHaveLength(3);
    });
  });

  describe('Successful creation (201 Created)', () => {
    it('creates a class subscription as Admin: returns 201, active, version 1, Location header, numeric price, lowercase enums, activeClientCount 0, and writes audit row', async () => {
      const payload = validPlanPayload({
        name: `  ${TEST_PREFIX}Nutrition Coaching  `,
        price: 250.75,
        creditType: 'class',
        creditsIncluded: 15,
        creditRefill: 'monthly',
        billingCycle: 'month',
        externalRef: 'should_not_be_saved',
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/api/v1/plans/${res.body.data.id}`);

      const data = res.body.data;
      expect(data.name).toBe(`${TEST_PREFIX}Nutrition Coaching`);
      expect(data.status).toBe('active');
      expect(data.version).toBe(1);
      expect(typeof data.price).toBe('number');
      expect(data.price).toBe(250.75);
      expect(data.kind).toBe('subscription');
      expect(data.billingCycle).toBe('month');
      expect(data.creditType).toBe('class');
      expect(data.creditRefill).toBe('monthly');
      expect(data.validityUnit).toBe('month');
      expect(data.startsOn).toBe('purchase_date');
      expect(data.visibility).toBe('public');
      expect(data.section).toBe('class_membership');
      expect(data.creditSummary).toBe('15 class credits a month');
      expect(data.activeClientCount).toBe(0);

      // Verify externalRef was stripped and not persisted
      const dbPlan = await prisma.membershipPlan.findUnique({ where: { id: data.id } });
      expect(dbPlan).toBeDefined();
      expect(dbPlan.externalRef).toBeNull();
      expect(dbPlan.version).toBe(1);
      expect(dbPlan.status).toBe('ACTIVE');

      // Verify transactional audit row
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: AuditAction.PLAN_CREATED,
          actorId: adminUser.id,
          reason: `${TEST_PREFIX}Nutrition Coaching (${dbPlan.id})`,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.actorId).toBe(adminUser.id);
      expect(auditLog.actorRole).toBe(Role.ADMIN);
      expect(auditLog.email).toBe(adminUser.email);
      expect(auditLog.reason).toBe(`${TEST_PREFIX}Nutrition Coaching (${dbPlan.id})`);
    });

    it('creates a time-based plan as Owner and derives section online_coaching and creditSummary Time-based access', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Personal Online Coaching`,
        creditType: 'time',
        creditsIncluded: 0,
        creditRefill: null,
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(ownerUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.section).toBe('online_coaching');
      expect(res.body.data.creditSummary).toBe('Time-based access');

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: AuditAction.PLAN_CREATED,
          actorId: ownerUser.id,
          reason: `${TEST_PREFIX}Personal Online Coaching (${res.body.data.id})`,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.actorRole).toBe(Role.OWNER);
    });

    it('creates a single appointment credit pack with creditSummary "1 appointment credit"', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Single PT Session`,
        kind: 'credit_pack',
        billingCycle: 'one_off',
        creditType: 'appointment',
        creditsIncluded: 1,
        creditRefill: 'once',
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.creditSummary).toBe('1 appointment credit');
    });

    it('creates a Hyrox time-based plan with ticket example body (creditType time, creditsIncluded 0, no creditRefill) returning 201 and ticket response shape', async () => {
      const hyroxPayload = {
        name: `${TEST_PREFIX}Hyrox Personalised Programming`,
        kind: 'subscription',
        price: 200,
        billingCycle: 'month',
        creditType: 'time',
        creditsIncluded: 0,
        // no creditRefill in body
        validityValue: 1,
        validityUnit: 'month',
        startsOn: 'purchase_date',
        oneTimePurchasePerClient: false,
        visibility: 'public',
        description: 'Hyrox time-based access',
      };

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(hyroxPayload);

      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/api/v1/plans/${res.body.data.id}`);
      expect(res.body).toEqual({
        success: true,
        message: expect.any(String),
        data: {
          id: expect.any(String),
          name: hyroxPayload.name,
          kind: 'subscription',
          price: 200,
          billingCycle: 'month',
          creditType: 'time',
          creditsIncluded: 0,
          creditRefill: null,
          validityValue: 1,
          validityUnit: 'month',
          startsOn: 'purchase_date',
          oneTimePurchasePerClient: false,
          visibility: 'public',
          status: 'active',
          version: 1,
          description: hyroxPayload.description,
          section: 'online_coaching',
          creditSummary: 'Time-based access',
          creditNote: 'Time-based access',
          activeClientCount: 0,
          membershipId: null,
          membership: null,
          term: null,
          recurring: false,
          periodMonths: null,
          joiningFee: 0,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });

      expect(typeof res.body.data.price).toBe('number');
      expect(res.body.data.creditRefill).toBeNull();
      expect(res.body.data.section).toBe('online_coaching');
      expect(res.body.data.creditSummary).toBe('Time-based access');
      expect(res.body.data.activeClientCount).toBe(0);
    });
  });

  describe('Duplicate name conflict (409 PLAN_DUPLICATE_NAME)', () => {
    it('returns 409 PLAN_DUPLICATE_NAME when comparing "Nutrition Coaching" vs "nutrition coaching" case-insensitively', async () => {
      const baseName = `${TEST_PREFIX}Unique Nutrition Coaching`;
      const firstPayload = validPlanPayload({ name: baseName });

      const firstRes = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(firstPayload);
      expect(firstRes.status).toBe(201);

      // Attempt to create with lower-cased name
      const secondPayload = validPlanPayload({ name: baseName.toLowerCase() });
      const secondRes = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(secondPayload);

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.code).toBe('PLAN_DUPLICATE_NAME');
    });
  });

  describe('Web + Mobile compatibility', () => {
    it('returns identical status and data whether Origin header is present (browser) or omitted (native mobile app)', async () => {
      const webPayload = validPlanPayload({ name: `${TEST_PREFIX}Web Plan` });
      const mobilePayload = validPlanPayload({ name: `${TEST_PREFIX}Mobile Plan` });

      // Web client: sends browser Origin
      const webRes = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .set('Origin', 'http://localhost:3000')
        .send(webPayload);

      // Mobile client: native Android Kotlin sends NO Origin header
      const mobileRes = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(mobilePayload);

      expect(webRes.status).toBe(201);
      expect(mobileRes.status).toBe(201);
      expect(webRes.body.success).toBe(true);
      expect(mobileRes.body.success).toBe(true);
      expect(Object.keys(webRes.body.data).sort()).toEqual(Object.keys(mobileRes.body.data).sort());
    });
  });

  describe('Rate limiter', () => {
    it('returns 429 TOO_MANY_REQUESTS with standard envelope when rate limit is exceeded', async () => {
      // Test isolated express instance with strict max: 1 rate limiter
      const express = require('express');
      const testApp = express();
      testApp.use(express.json());
      const strictLimiter = createPlanLimiter({ max: 1, windowMs: 60000 });
      testApp.post('/test-plans', strictLimiter, (_req, res) =>
        res.status(200).json({ success: true }),
      );
      testApp.use(require('../../src/middlewares/errorHandler.middleware'));

      // 1st request succeeds
      const res1 = await request(testApp).post('/test-plans').send({});
      expect(res1.status).toBe(200);

      // 2nd request exceeds limit
      const res2 = await request(testApp).post('/test-plans').send({});
      expect(res2.status).toBe(429);
      expect(res2.body.success).toBe(false);
      expect(res2.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('SLAPP 84/106 - Membership modes', () => {
    it('Mode 1: attaches plan to existing membership and returns nested membership', async () => {
      const existingMem = await createTestMembership(TEST_PREFIX, {
        name: `${TEST_PREFIX}ExistingMem_${Date.now()}`,
        description: 'Existing Description',
      });

      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Plan Under Mem_${Date.now()}`,
        membershipId: existingMem.id,
        term: '1 Year',
        recurring: true,
        periodMonths: 12,
        joiningFee: 100,
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.membershipId).toBe(existingMem.id);
      expect(res.body.data.membership).toEqual({
        id: existingMem.id,
        name: existingMem.name,
        description: 'Existing Description',
      });
      expect(res.body.data.term).toBe('1 Year');
      expect(res.body.data.recurring).toBe(true);
      expect(res.body.data.periodMonths).toBe(12);
      expect(res.body.data.joiningFee).toBe(100);
    });

    it('Mode 2: creates new membership + plan + audit row in ONE transaction', async () => {
      const newMemName = `${TEST_PREFIX}NewMem_${Date.now()}`;
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Plan With New Mem_${Date.now()}`,
        membership: {
          name: newMemName,
          description: 'Brand new membership',
        },
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.membershipId).toBeDefined();
      expect(res.body.data.membership).toMatchObject({
        name: newMemName,
        description: 'Brand new membership',
      });

      // Verify membership was created in DB
      const dbMem = await prisma.membership.findUnique({
        where: { id: res.body.data.membershipId },
      });
      expect(dbMem).not.toBeNull();
      expect(dbMem.name).toBe(newMemName);

      // Verify audit row was created
      const audits = await prisma.auditLog.findMany({
        where: { reason: { contains: res.body.data.id } },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe(AuditAction.PLAN_CREATED);
    });

    it('Mode 3: creates standalone plan when neither membershipId nor membership is provided', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Standalone_${Date.now()}`,
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.membershipId).toBeNull();
      expect(res.body.data.membership).toBeNull();
    });

    it('rejects mutual exclusivity violation with 400 when both membershipId and membership are provided', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Both_${Date.now()}`,
        membershipId: '123e4567-e89b-12d3-a456-426614174000',
        membership: { name: 'Some Name' },
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-existent membershipId with 400', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}UnknownMem_${Date.now()}`,
        membershipId: '00000000-0000-0000-0000-000000000000',
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'membershipId' })]),
      );
    });

    it('rejects duplicate membership name in Mode 2 with 409 MEMBERSHIP_EXISTS', async () => {
      const existingMem = await createTestMembership(TEST_PREFIX, {
        name: `${TEST_PREFIX}DupNameMem_${Date.now()}`,
      });

      const payload = validPlanPayload({
        name: `${TEST_PREFIX}Plan Dup Mem_${Date.now()}`,
        membership: { name: existingMem.name.toUpperCase() },
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MEMBERSHIP_EXISTS');
    });

    it('rolls back entire transaction if plan creation fails during Mode 2', async () => {
      const existingPlan = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(validPlanPayload({ name: `${TEST_PREFIX}CollidePlan_${Date.now()}` }));
      expect(existingPlan.status).toBe(201);

      const uniqueMemName = `${TEST_PREFIX}RollbackMem_${Date.now()}`;
      // Send colliding plan name with a new membership
      const failPayload = validPlanPayload({
        name: existingPlan.body.data.name,
        membership: { name: uniqueMemName },
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(failPayload);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PLAN_DUPLICATE_NAME');

      // Verify the new membership was NOT created (rolled back!)
      const dbMem = await prisma.membership.findFirst({
        where: { name: uniqueMemName },
      });
      expect(dbMem).toBeNull();
    });

    it('strips helper fields memMode, newMemName, newMemDesc and creates plan successfully', async () => {
      const payload = validPlanPayload({
        name: `${TEST_PREFIX}HelperFields_${Date.now()}`,
        memMode: 'new',
        newMemName: 'Helper Name',
        newMemDesc: 'Helper Desc',
      });

      const res = await request(app)
        .post('/api/v1/plans')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.memMode).toBeUndefined();
      expect(res.body.data.newMemName).toBeUndefined();
      expect(res.body.data.newMemDesc).toBeUndefined();
    });
  });
});
