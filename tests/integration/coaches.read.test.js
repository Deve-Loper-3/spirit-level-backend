const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { CoachType, CoachStatus } = require('../../src/constants/coach');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(60000);

const COACHES_URL = '/api/v1/coaches';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// The dev DB may hold other coaches, so every list assertion filters by this unique token.
const TOKEN = `Zqx${Date.now()}`;

describe('GET /api/v1/coaches and /api/v1/coaches/:coachId', () => {
  const testData = createTestData('coaches_read');
  const seeded = {};
  let app;
  let admin;
  let owner;

  // Oldest first; the list is newest first, so the expected order is the reverse of this array.
  const COACH_SPECS = [
    { key: 'alpha', name: 'Alpha', coachType: CoachType.SALARIED, status: CoachStatus.ACTIVE },
    { key: 'bravo', name: 'Bravo', coachType: CoachType.FREELANCE, status: CoachStatus.ACTIVE },
    {
      key: 'charlie',
      name: 'Charlie',
      coachType: CoachType.SALARIED,
      status: CoachStatus.INACTIVE,
    },
    { key: 'delta', name: 'Delta', coachType: CoachType.FREELANCE, status: CoachStatus.INACTIVE },
    { key: 'echo', name: 'Echo', coachType: CoachType.SALARIED, status: CoachStatus.ACTIVE },
    {
      key: 'percent',
      name: '100% Sure',
      coachType: CoachType.FREELANCE,
      status: CoachStatus.ACTIVE,
    },
  ];
  const EXPECTED_ORDER = [...COACH_SPECS].reverse().map((spec) => spec.name);

  const seedCoach = async (spec, index) => {
    const user = await testData.createUser({
      role: Role.COACH,
      fullName: `${TOKEN} ${spec.name}`,
      status: spec.status === CoachStatus.ACTIVE ? AccountStatus.ACTIVE : AccountStatus.DISABLED,
      profileImageUrl: spec.key === 'alpha' ? 'https://example.test/a.jpg' : null,
    });
    const coach = await prisma.coach.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        coachType: spec.coachType,
        status: spec.status,
        bio: spec.key === 'alpha' ? 'Alpha bio' : null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      },
    });
    seeded[spec.key] = { user, coach };
  };

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    for (const [index, spec] of COACH_SPECS.entries()) {
      await seedCoach(spec, index);
    }
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const get = (caller, url = COACHES_URL) =>
    request(app).get(url).set('Authorization', bearerFor(caller));

  const list = (query, caller = admin) =>
    get(caller, COACHES_URL).query({ search: TOKEN, ...query });

  const namesOf = (res) => res.body.data.map((coach) => coach.fullName.replace(`${TOKEN} `, ''));

  describe('GET /coaches - response shape', () => {
    it('returns { success, data, pagination } with the full view', async () => {
      const res = await list({});

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'pagination', 'success']);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 6, totalPages: 1 });
      const alpha = res.body.data.find((c) => c.id === seeded.alpha.coach.id);
      expect(alpha).toEqual({
        id: seeded.alpha.coach.id,
        userId: seeded.alpha.user.id,
        fullName: `${TOKEN} Alpha`,
        email: seeded.alpha.user.email,
        phone: seeded.alpha.user.phone,
        profileImageUrl: 'https://example.test/a.jpg',
        bio: 'Alpha bio',
        coachType: CoachType.SALARIED,
        status: CoachStatus.ACTIVE,
        createdAt: seeded.alpha.coach.createdAt.toISOString(),
        updatedAt: seeded.alpha.coach.updatedAt.toISOString(),
      });
    });

    it('never exposes secrets, roles or account status', async () => {
      const res = await list({});

      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password|"role"|mustChange/i);
    });

    it('lets an OWNER list coaches too', async () => {
      const res = await list({}, owner);

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(6);
    });
  });

  describe('GET /coaches - pagination', () => {
    it('orders newest first', async () => {
      const res = await list({});

      expect(namesOf(res)).toEqual(EXPECTED_ORDER);
    });

    it.each([
      [1, EXPECTED_ORDER.slice(0, 2)],
      [2, EXPECTED_ORDER.slice(2, 4)],
      [3, EXPECTED_ORDER.slice(4, 6)],
    ])('returns page %i of limit 2', async (page, expected) => {
      const res = await list({ page, limit: 2 });

      expect(res.status).toBe(200);
      expect(namesOf(res)).toEqual(expected);
      expect(res.body.pagination).toEqual({ page, limit: 2, total: 6, totalPages: 3 });
    });

    it('returns a short last page', async () => {
      const res = await list({ page: 2, limit: 4 });

      expect(namesOf(res)).toEqual(EXPECTED_ORDER.slice(4));
      expect(res.body.pagination).toEqual({ page: 2, limit: 4, total: 6, totalPages: 2 });
    });

    it('returns 200 with an empty list and correct totals for a page past the end', async () => {
      const res = await list({ page: 4, limit: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ page: 4, limit: 2, total: 6, totalPages: 3 });
    });

    it('uses limit 20 by default and accepts limit 100', async () => {
      const res = await list({ limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
    });

    it.each([
      [{ limit: 101 }, 'limit'],
      [{ limit: 0 }, 'limit'],
      [{ page: 0 }, 'page'],
      [{ page: -1 }, 'page'],
      [{ page: 'abc' }, 'page'],
      [{ limit: 1.5 }, 'limit'],
    ])('returns 400 VALIDATION_ERROR for %j', async (query, field) => {
      const res = await list(query);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });
  });

  describe('GET /coaches - search', () => {
    it('finds by a part of the name, case-insensitively', async () => {
      const res = await get(admin, COACHES_URL).query({ search: `${TOKEN.toUpperCase()} aLpHa` });

      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].id).toBe(seeded.alpha.coach.id);
    });

    it.each([
      ['lower case', (email) => email.toLowerCase()],
      ['upper case', (email) => email.toUpperCase()],
    ])('finds by the full email in %s', async (_label, transform) => {
      const res = await get(admin, COACHES_URL).query({
        search: transform(seeded.bravo.user.email),
      });

      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].id).toBe(seeded.bravo.coach.id);
    });

    it('returns an empty list when nothing matches', async () => {
      const res = await get(admin, COACHES_URL).query({ search: `${TOKEN}-no-such-coach` });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('treats % and _ as plain characters', async () => {
      const literal = await get(admin, COACHES_URL).query({ search: '100% Sure' });
      const wildcard = await get(admin, COACHES_URL).query({ search: `${TOKEN} 1_0% Sure` });

      expect(literal.body.data.map((c) => c.id)).toContain(seeded.percent.coach.id);
      expect(wildcard.body.pagination.total).toBe(0);
    });

    it('ignores a blank search', async () => {
      const res = await get(admin, COACHES_URL).query({ search: '   ' });

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(6);
    });

    it('returns 400 for a search over 100 characters', async () => {
      const res = await get(admin, COACHES_URL).query({ search: 'a'.repeat(101) });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /coaches - filters', () => {
    it.each([
      [CoachStatus.ACTIVE, ['100% Sure', 'Echo', 'Bravo', 'Alpha']],
      [CoachStatus.INACTIVE, ['Delta', 'Charlie']],
    ])('filters by status %s', async (status, expected) => {
      const res = await list({ status });

      expect(namesOf(res)).toEqual(expected);
      expect(res.body.pagination.total).toBe(expected.length);
    });

    it.each([
      [CoachType.SALARIED, ['Echo', 'Charlie', 'Alpha']],
      [CoachType.FREELANCE, ['100% Sure', 'Delta', 'Bravo']],
    ])('filters by coachType %s', async (coachType, expected) => {
      const res = await list({ coachType });

      expect(namesOf(res)).toEqual(expected);
    });

    it('combines status, coachType and search', async () => {
      const res = await list({ status: CoachStatus.ACTIVE, coachType: CoachType.SALARIED });

      expect(namesOf(res)).toEqual(['Echo', 'Alpha']);
    });

    it('paginates the filtered result', async () => {
      const res = await list({ status: CoachStatus.ACTIVE, limit: 3, page: 2 });

      expect(namesOf(res)).toEqual(['Alpha']);
      expect(res.body.pagination).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    });

    it.each([
      [{ status: 'DISABLED' }, 'status'],
      [{ status: 'active' }, 'status'],
      [{ coachType: 'CONTRACTOR' }, 'coachType'],
    ])('returns 400 for the invalid filter %j', async (query, field) => {
      const res = await list(query);

      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    it('returns 400 for an unknown query parameter', async () => {
      const res = await list({ sort: 'name' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /coaches/:coachId', () => {
    it('returns the full view in { success, data }', async () => {
      const res = await get(admin, `${COACHES_URL}/${seeded.alpha.coach.id}`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
      expect(res.body.data).toMatchObject({
        id: seeded.alpha.coach.id,
        userId: seeded.alpha.user.id,
        fullName: `${TOKEN} Alpha`,
        email: seeded.alpha.user.email,
        bio: 'Alpha bio',
        coachType: CoachType.SALARIED,
        status: CoachStatus.ACTIVE,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|"role"/i);
    });

    it('also returns an INACTIVE coach to an admin', async () => {
      const res = await get(owner, `${COACHES_URL}/${seeded.charlie.coach.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(CoachStatus.INACTIVE);
    });

    it('returns 404 COACH_NOT_FOUND for an unknown id', async () => {
      const res = await get(admin, `${COACHES_URL}/${MISSING_ID}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        message: Messages.COACH_NOT_FOUND,
        code: AppErrors.COACH_NOT_FOUND.code,
      });
    });

    it('returns 404 when the id is a user id, not a coach id', async () => {
      const res = await get(admin, `${COACHES_URL}/${seeded.alpha.user.id}`);

      expect(res.status).toBe(404);
    });

    it.each(['abc', '123'])('returns 400 VALIDATION_ERROR for the malformed id %s', async (id) => {
      const res = await get(admin, `${COACHES_URL}/${id}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
      expect(res.body.errors[0]).toEqual({ field: 'coachId', message: Messages.COACH_ID_INVALID });
    });
  });

  describe('authentication and authorization', () => {
    const urls = () => [COACHES_URL, `${COACHES_URL}/${seeded.alpha.coach.id}`];

    it('returns 401 without a token on both routes', async () => {
      for (const url of urls()) {
        const res = await request(app).get(url);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          success: false,
          message: Messages.NO_TOKEN_PROVIDED,
          code: AppErrors.UNAUTHORIZED.code,
        });
      }
    });

    it('returns 401 INVALID_TOKEN for an invalid token on both routes', async () => {
      for (const url of urls()) {
        const res = await request(app).get(url).set('Authorization', 'Bearer not-a-jwt');

        expect(res.status).toBe(401);
        expect(res.body.code).toBe(AppErrors.INVALID_TOKEN.code);
      }
    });

    it.each([
      [AccountStatus.DISABLED, AppErrors.ACCOUNT_DISABLED],
      [AccountStatus.PENDING, AppErrors.REGISTRATION_INCOMPLETE],
    ])('returns 403 for a %s admin', async (status, appError) => {
      const caller = await testData.createUser({ role: Role.ADMIN, status });

      const res = await get(caller, COACHES_URL);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(appError.code);
    });

    // Coach and Member now read through the public view; see coaches.access.test.js.
    it('keeps the admin-only full view: a MEMBER never gets email or phone from the list', async () => {
      const member = await testData.createUser({ role: Role.MEMBER });

      const res = await get(member, COACHES_URL).query({ search: TOKEN });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/@test\.invalid|"phone"/);
    });
  });
});
