const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestMemberships, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(35000);

describe('POST /api/v1/memberships', () => {
  const TEST_PREFIX = 'test_mem_cr_';
  const testData = createTestData('mem_cr');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;

  const cleanup = async () => {
    await deleteTestPlans(TEST_PREFIX);
    await deleteTestMemberships(TEST_PREFIX);
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

  const postMembership = (payload, { token = bearerFor(adminUser), origin } = {}) => {
    const req = request(app).post('/api/v1/memberships');
    if (token) req.set('Authorization', token);
    if (origin) req.set('Origin', origin);
    return req.send(payload);
  };

  describe('Success path', () => {
    it('creates a membership and returns 201 with Location header and empty plans', async () => {
      const name = `${TEST_PREFIX}Gold_${Date.now()}`;
      const res = await postMembership({
        name,
        description: 'VIP Gold Access',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.MEMBERSHIP_CREATED_SUCCESS,
        data: {
          name,
          description: 'VIP Gold Access',
          planCount: 0,
          plans: [],
        },
      });
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.createdAt).toBeDefined();
      // There is no GET /memberships/:id, so no Location header is sent.
      expect(res.headers.location).toBeUndefined();
    });

    it('trims name and allows description to be omitted', async () => {
      const uniqueSuffix = Date.now();
      const rawName = `   ${TEST_PREFIX}Trimmed_${uniqueSuffix}   `;
      const res = await postMembership({
        name: rawName,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(`${TEST_PREFIX}Trimmed_${uniqueSuffix}`);
      expect(res.body.data.description).toBeNull();
    });

    it('allows OWNER to create a membership', async () => {
      const name = `${TEST_PREFIX}Owner_${Date.now()}`;
      const res = await postMembership(
        { name, description: 'Created by owner' },
        { token: bearerFor(ownerUser) },
      );

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(name);
    });
  });

  describe('Validation & duplicates', () => {
    it('rejects missing or empty name with 400 VALIDATION_ERROR', async () => {
      const missingRes = await postMembership({});
      expect(missingRes.status).toBe(400);
      expect(missingRes.body).toMatchObject({
        success: false,
        code: AppErrors.VALIDATION_ERROR.code,
      });

      const emptyRes = await postMembership({ name: '   ' });
      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
    });

    it('rejects name exceeding 80 characters with 400', async () => {
      const res = await postMembership({ name: 'A'.repeat(81) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
    });

    it('rejects description exceeding 500 characters with 400', async () => {
      const res = await postMembership({
        name: `${TEST_PREFIX}LongDesc`,
        description: 'D'.repeat(501),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
    });

    it('rejects case-insensitive duplicate name with 409 MEMBERSHIP_EXISTS', async () => {
      const baseName = `${TEST_PREFIX}Dup_${Date.now()}`;
      const first = await postMembership({ name: baseName.toLowerCase() });
      expect(first.status).toBe(201);

      const second = await postMembership({ name: baseName.toUpperCase() });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({
        success: false,
        message: Messages.MEMBERSHIP_EXISTS,
        code: 'MEMBERSHIP_EXISTS',
      });
    });
  });

  describe('RBAC', () => {
    it('forbids COACH with 403', async () => {
      const res = await postMembership(
        { name: `${TEST_PREFIX}CoachAttempt` },
        { token: bearerFor(coachUser) },
      );
      expect(res.status).toBe(403);
    });

    it('forbids MEMBER with 403', async () => {
      const res = await postMembership(
        { name: `${TEST_PREFIX}MemberAttempt` },
        { token: bearerFor(memberUser) },
      );
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated caller with 401', async () => {
      const res = await postMembership({ name: `${TEST_PREFIX}AnonAttempt` }, { token: null });
      expect(res.status).toBe(401);
    });
  });

  describe('Web (Origin) vs Mobile (no Origin) parity', () => {
    it('works identically with browser Origin header and without Origin header (Kotlin)', async () => {
      const webRes = await postMembership(
        { name: `${TEST_PREFIX}Web_${Date.now()}` },
        { origin: 'http://localhost:3000' },
      );
      expect(webRes.status).toBe(201);

      const mobileRes = await postMembership(
        { name: `${TEST_PREFIX}Mobile_${Date.now()}` },
        { origin: undefined },
      );
      expect(mobileRes.status).toBe(201);
    });
  });

  describe('Method not allowed', () => {
    it('returns 405 for PUT and DELETE on /api/v1/memberships', async () => {
      const putRes = await request(app)
        .put('/api/v1/memberships')
        .set('Authorization', bearerFor(adminUser));
      expect(putRes.status).toBe(405);
      expect(putRes.headers.allow).toContain('GET');
      expect(putRes.headers.allow).toContain('POST');

      const delRes = await request(app)
        .delete('/api/v1/memberships')
        .set('Authorization', bearerFor(adminUser));
      expect(delRes.status).toBe(405);
    });
  });
});
