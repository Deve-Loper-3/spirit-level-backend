// The trusted-image-URL check derives the allowed host from this token.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { CoachType, CoachStatus } = require('../../src/constants/coach');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(90000);

const COACHES_URL = '/api/v1/coaches';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const IMAGE_URL = 'https://teststore.public.blob.vercel-storage.com/profile-images/me.jpg';
const PUBLIC_KEYS = ['bio', 'fullName', 'id', 'profileImageUrl'];
const FULL_KEYS = [
  'bio',
  'coachType',
  'createdAt',
  'email',
  'fullName',
  'id',
  'phone',
  'profileImageUrl',
  'status',
  'updatedAt',
  'userId',
];

// The dev DB may hold other coaches, so every list assertion filters by this unique token.
const TOKEN = `Zqa${Date.now()}`;

describe('coach access control by role', () => {
  const testData = createTestData('coaches_access');
  let app;
  let admin;
  let owner;
  let member;
  let alpha; // ACTIVE
  let bravo; // ACTIVE
  let dormant; // INACTIVE, user DISABLED
  let noProfileCoach; // COACH role without a Coach row

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    noProfileCoach = await testData.createUser({ role: Role.COACH });
    alpha = await testData.createCoach({
      user: { fullName: `${TOKEN} Alpha`, profileImageUrl: IMAGE_URL },
      coach: { bio: 'Alpha bio', createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)) },
    });
    bravo = await testData.createCoach({
      user: { fullName: `${TOKEN} Bravo` },
      coach: {
        bio: 'Bravo bio',
        coachType: CoachType.FREELANCE,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)),
      },
    });
    dormant = await testData.createCoach({
      user: { fullName: `${TOKEN} Dormant`, status: AccountStatus.DISABLED },
      coach: {
        bio: 'Dormant bio',
        status: CoachStatus.INACTIVE,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 3)),
      },
    });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const as = (caller, method, url) =>
    request(app)
      [method](url)
      .set('Authorization', bearerFor(caller))
      .set('User-Agent', 'jest-coach-access/1.0');

  const list = (caller, query = {}) =>
    as(caller, 'get', COACHES_URL).query({ search: TOKEN, ...query });

  const getById = (caller, id) => as(caller, 'get', `${COACHES_URL}/${id}`);
  const patch = (caller, id, body) => as(caller, 'patch', `${COACHES_URL}/${id}`).send(body);
  const setStatus = (caller, id, body) =>
    as(caller, 'patch', `${COACHES_URL}/${id}/status`).send(body);

  const keysOf = (object) => Object.keys(object).sort();
  const namesOf = (res) => res.body.data.map((c) => c.fullName.replace(`${TOKEN} `, ''));
  const reloadCoach = (id) => prisma.coach.findUnique({ where: { id } });
  const reloadUser = (id) => prisma.user.findUnique({ where: { id } });

  describe('GET /coaches', () => {
    it.each([
      ['a COACH', () => alpha.user],
      ['a MEMBER', () => member],
    ])('%s gets the public view of ACTIVE coaches only', async (_label, who) => {
      const res = await list(who());

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'pagination', 'success']);
      expect(namesOf(res)).toEqual(['Bravo', 'Alpha']);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      for (const item of res.body.data) {
        expect(keysOf(item)).toEqual(PUBLIC_KEYS);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/@test\.invalid|"phone"|"userId"|"status"/);
    });

    it('returns exactly the same list to a COACH and to a MEMBER', async () => {
      const asCoach = await list(bravo.user);
      const asMember = await list(member);

      expect(asCoach.body).toEqual(asMember.body);
    });

    it('shows a COACH their own row in the public view too', async () => {
      const res = await list(alpha.user);

      const own = res.body.data.find((c) => c.id === alpha.coach.id);
      expect(keysOf(own)).toEqual(PUBLIC_KEYS);
      expect(own).toEqual({
        id: alpha.coach.id,
        fullName: `${TOKEN} Alpha`,
        profileImageUrl: IMAGE_URL,
        bio: 'Alpha bio',
      });
    });

    it('never lists an INACTIVE coach to a COACH or a MEMBER, not even by name', async () => {
      for (const who of [alpha.user, member]) {
        const res = await list(who, { search: `${TOKEN} Dormant` });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.pagination.total).toBe(0);
      }
    });

    it.each([
      ['a COACH', () => alpha.user],
      ['a MEMBER', () => member],
    ])('%s finds a coach by name', async (_label, who) => {
      const res = await list(who(), { search: `${TOKEN.toLowerCase()} alpha` });

      expect(res.body.data.map((c) => c.id)).toEqual([alpha.coach.id]);
    });

    it.each([
      ['a COACH', () => alpha.user],
      ['a MEMBER', () => member],
    ])('%s finds nothing when searching by email (full or partial)', async (_label, who) => {
      const full = await as(who(), 'get', COACHES_URL).query({ search: bravo.user.email });
      const partial = await as(who(), 'get', COACHES_URL).query({ search: 'coaches_access' });
      const upper = await as(who(), 'get', COACHES_URL).query({
        search: bravo.user.email.toUpperCase(),
      });

      for (const res of [full, partial, upper]) {
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.pagination.total).toBe(0);
      }
    });

    it('still lets an ADMIN find a coach by email', async () => {
      const res = await as(admin, 'get', COACHES_URL).query({ search: bravo.user.email });

      expect(res.body.data.map((c) => c.id)).toEqual([bravo.coach.id]);
    });

    it.each([
      ['a COACH', () => alpha.user],
      ['a MEMBER', () => member],
    ])('%s gets 400 VALIDATION_ERROR for the status and coachType filters', async (_l, who) => {
      for (const query of [
        { status: 'INACTIVE' },
        { status: 'ACTIVE' },
        { coachType: 'FREELANCE' },
      ]) {
        const res = await list(who(), query);

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          success: false,
          message: Messages.VALIDATION_FAILED,
          code: AppErrors.VALIDATION_ERROR.code,
        });
      }
    });

    it('paginates the public list', async () => {
      const first = await list(member, { limit: 1, page: 1 });
      const second = await list(member, { limit: 1, page: 2 });
      const beyond = await list(member, { limit: 1, page: 3 });

      expect(namesOf(first)).toEqual(['Bravo']);
      expect(namesOf(second)).toEqual(['Alpha']);
      expect(second.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
      expect(beyond.status).toBe(200);
      expect(beyond.body.data).toEqual([]);
    });

    it.each([Role.ADMIN, Role.OWNER])(
      '%s keeps the full view with INACTIVE coaches and filters',
      async (role) => {
        const who = role === Role.ADMIN ? admin : owner;

        const all = await list(who);
        const inactive = await list(who, { status: 'INACTIVE' });
        const freelance = await list(who, { coachType: 'FREELANCE' });

        expect(namesOf(all)).toEqual(['Dormant', 'Bravo', 'Alpha']);
        expect(keysOf(all.body.data[0])).toEqual(FULL_KEYS);
        expect(namesOf(inactive)).toEqual(['Dormant']);
        expect(namesOf(freelance)).toEqual(['Bravo']);
      },
    );

    it('answers 401 without a token', async () => {
      const res = await request(app).get(COACHES_URL);

      expect(res.status).toBe(401);
    });

    it.each([Role.COACH, Role.MEMBER])('answers 403 for a %s who is not ACTIVE', async (role) => {
      for (const [status, appError] of [
        [AccountStatus.DISABLED, AppErrors.ACCOUNT_DISABLED],
        [AccountStatus.PENDING, AppErrors.REGISTRATION_INCOMPLETE],
      ]) {
        const caller = await testData.createUser({ role, status });

        const res = await list(caller);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe(appError.code);
      }
    });
  });

  describe('GET /coaches/:coachId', () => {
    it('gives a COACH the full view of their own profile', async () => {
      const res = await getById(alpha.user, alpha.coach.id);

      expect(res.status).toBe(200);
      expect(keysOf(res.body.data)).toEqual(FULL_KEYS);
      expect(res.body.data).toMatchObject({
        id: alpha.coach.id,
        userId: alpha.user.id,
        email: alpha.user.email,
        phone: alpha.user.phone,
        status: CoachStatus.ACTIVE,
      });
    });

    it('gives a COACH exactly the four public keys for another ACTIVE coach', async () => {
      const res = await getById(alpha.user, bravo.coach.id);

      expect(res.status).toBe(200);
      expect(keysOf(res.body.data)).toEqual(PUBLIC_KEYS);
      expect(res.body.data).toEqual({
        id: bravo.coach.id,
        fullName: `${TOKEN} Bravo`,
        profileImageUrl: null,
        bio: 'Bravo bio',
      });
    });

    it('gives a MEMBER exactly the four public keys, without email or phone', async () => {
      const res = await getById(member, alpha.coach.id);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(expect.arrayContaining(['success', 'data']));
      expect(keysOf(res.body.data)).toEqual(PUBLIC_KEYS);
      expect(JSON.stringify(res.body)).not.toMatch(/@test\.invalid|"phone"/);
    });

    it('answers 404 COACH_NOT_FOUND to a COACH for another INACTIVE coach', async () => {
      const res = await getById(alpha.user, dormant.coach.id);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        message: Messages.COACH_NOT_FOUND,
        code: AppErrors.COACH_NOT_FOUND.code,
      });
    });

    it('answers 404 (never 403) to a MEMBER for an INACTIVE coach, identical to an unknown id', async () => {
      const inactive = await getById(member, dormant.coach.id);
      const unknown = await getById(member, MISSING_ID);

      expect(inactive.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(inactive.body).toEqual(unknown.body);
    });

    it.each([
      ['a COACH', () => alpha.user],
      ['a MEMBER', () => member],
    ])('answers 404 to %s for an unknown id and 400 for a malformed one', async (_label, who) => {
      const unknown = await getById(who(), MISSING_ID);
      const malformed = await getById(who(), 'not-a-uuid');

      expect(unknown.status).toBe(404);
      expect(malformed.status).toBe(400);
      expect(malformed.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
    });

    it.each([Role.ADMIN, Role.OWNER])('lets %s read an INACTIVE coach in full', async (role) => {
      const res = await getById(role === Role.ADMIN ? admin : owner, dormant.coach.id);

      expect(res.status).toBe(200);
      expect(keysOf(res.body.data)).toEqual(FULL_KEYS);
      expect(res.body.data.status).toBe(CoachStatus.INACTIVE);
    });

    it('answers 401 without a token', async () => {
      const res = await request(app).get(`${COACHES_URL}/${alpha.coach.id}`);

      expect(res.status).toBe(401);
    });

    it.each([Role.COACH, Role.MEMBER])('answers 403 for a %s who is not ACTIVE', async (role) => {
      const caller = await testData.createUser({ role, status: AccountStatus.DISABLED });

      const res = await getById(caller, alpha.coach.id);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.ACCOUNT_DISABLED.code);
    });
  });

  describe('GET /coaches/me', () => {
    it('gives a COACH the full view of their own profile', async () => {
      const res = await as(bravo.user, 'get', `${COACHES_URL}/me`);

      expect(res.status).toBe(200);
      expect(keysOf(res.body.data)).toEqual(FULL_KEYS);
      expect(res.body.data).toMatchObject({
        id: bravo.coach.id,
        userId: bravo.user.id,
        email: bravo.user.email,
        coachType: CoachType.FREELANCE,
      });
    });

    it('answers 404 COACH_NOT_FOUND for a COACH user without a coach profile', async () => {
      const res = await as(noProfileCoach, 'get', `${COACHES_URL}/me`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.COACH_NOT_FOUND.code);
    });

    it.each([
      ['a MEMBER', () => member],
      ['an ADMIN', () => admin],
      ['an OWNER', () => owner],
    ])('answers 403 to %s', async (_label, who) => {
      const res = await as(who(), 'get', `${COACHES_URL}/me`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: Messages.FORBIDDEN,
        code: AppErrors.FORBIDDEN.code,
      });
    });

    it('answers 401 without a token', async () => {
      const res = await request(app).get(`${COACHES_URL}/me`);

      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /coaches/:coachId', () => {
    it('lets a COACH edit the four self-edit fields of their own profile', async () => {
      const { user, coach } = await testData.createCoach({
        user: { fullName: 'Before Name' },
        coach: { bio: 'Before bio' },
      });

      const res = await patch(user, coach.id, {
        fullName: 'After Name',
        phone: '+12025550177',
        profileImageUrl: IMAGE_URL,
        bio: 'After bio',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.COACH_UPDATED_SUCCESS,
        data: {
          id: coach.id,
          fullName: 'After Name',
          phone: '+12025550177',
          profileImageUrl: IMAGE_URL,
          bio: 'After bio',
        },
      });
      expect(keysOf(res.body.data)).toEqual(FULL_KEYS);
      expect(await reloadUser(user.id)).toMatchObject({
        fullName: 'After Name',
        phone: '+12025550177',
        profileImageUrl: IMAGE_URL,
        email: user.email,
        role: Role.COACH,
      });
      expect((await reloadCoach(coach.id)).bio).toBe('After bio');
    });

    it('lets a COACH clear their bio and image with null', async () => {
      const { user, coach } = await testData.createCoach({
        user: { profileImageUrl: IMAGE_URL },
        coach: { bio: 'To be cleared' },
      });

      const res = await patch(user, coach.id, { bio: null, profileImageUrl: null });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ bio: null, profileImageUrl: null });
    });

    it('records the COACH as the actor in the audit row, with field names only', async () => {
      const { user, coach } = await testData.createCoach();

      await patch(user, coach.id, { fullName: 'Secret Self Name', bio: 'Secret self bio' });

      const log = await prisma.auditLog.findFirst({
        where: { userId: user.id, action: AuditAction.COACH_UPDATED },
      });
      expect(log).toMatchObject({
        actorId: user.id,
        actorRole: Role.COACH,
        reason: 'fullName,bio',
      });
      expect(JSON.stringify(log)).not.toMatch(/Secret self/);
    });

    it.each([
      ['email', { email: 'new@example.com' }],
      ['coachType', { coachType: CoachType.FREELANCE }],
      ['status', { status: CoachStatus.INACTIVE }],
      ['email together with allowed fields', { bio: 'Sneaky', email: 'new@example.com' }],
    ])('rejects %s in a COACH body with 400 and changes nothing', async (_label, body) => {
      const { user, coach } = await testData.createCoach({ coach: { bio: 'Untouched' } });

      const res = await patch(user, coach.id, body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
      expect((await reloadCoach(coach.id)).bio).toBe('Untouched');
      expect((await reloadCoach(coach.id)).coachType).toBe(CoachType.SALARIED);
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
      expect((await reloadUser(user.id)).email).toBe(user.email);
    });

    it('rejects an empty body from a COACH with 400', async () => {
      const res = await patch(alpha.user, alpha.coach.id, {});

      expect(res.status).toBe(400);
    });

    it('answers 403 FORBIDDEN when a COACH edits another ACTIVE coach, and changes nothing', async () => {
      const res = await patch(alpha.user, bravo.coach.id, { bio: 'Hacked' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: Messages.FORBIDDEN,
        code: AppErrors.FORBIDDEN.code,
      });
      expect((await reloadCoach(bravo.coach.id)).bio).toBe('Bravo bio');
    });

    it('answers 404 when a COACH edits another INACTIVE coach (existence stays hidden)', async () => {
      const res = await patch(alpha.user, dormant.coach.id, { bio: 'Hacked' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.COACH_NOT_FOUND.code);
      expect((await reloadCoach(dormant.coach.id)).bio).toBe('Dormant bio');
    });

    it('answers 404 when a COACH edits an unknown id', async () => {
      const res = await patch(alpha.user, MISSING_ID, { bio: 'x' });

      expect(res.status).toBe(404);
    });

    it('answers 403 to a MEMBER and changes nothing', async () => {
      const res = await patch(member, alpha.coach.id, { bio: 'Hacked' });

      expect(res.status).toBe(403);
      expect((await reloadCoach(alpha.coach.id)).bio).toBe('Alpha bio');
    });

    it('answers 401 without a token', async () => {
      const res = await request(app).patch(`${COACHES_URL}/${alpha.coach.id}`).send({ bio: 'x' });

      expect(res.status).toBe(401);
    });

    it('answers 403 to a COACH who is not ACTIVE', async () => {
      const res = await patch(dormant.user, dormant.coach.id, { bio: 'x' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.ACCOUNT_DISABLED.code);
    });

    it.each([Role.ADMIN, Role.OWNER])(
      'keeps full edit rights for %s (email and coachType)',
      async (role) => {
        const { coach } = await testData.createCoach();

        const res = await patch(role === Role.ADMIN ? admin : owner, coach.id, {
          email: testData.newEmail(),
          coachType: CoachType.FREELANCE,
        });

        expect(res.status).toBe(200);
        expect(res.body.data.coachType).toBe(CoachType.FREELANCE);
      },
    );
  });

  describe('PATCH /coaches/:coachId/status', () => {
    it.each([
      ['a COACH on their own profile', () => alpha.user, () => alpha.coach.id],
      ['a COACH on another coach', () => alpha.user, () => bravo.coach.id],
      ['a MEMBER', () => member, () => bravo.coach.id],
    ])('answers 403 to %s and changes nothing', async (_label, who, coachId) => {
      const res = await setStatus(who(), coachId(), { status: CoachStatus.INACTIVE });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: Messages.FORBIDDEN,
        code: AppErrors.FORBIDDEN.code,
      });
      expect((await reloadCoach(alpha.coach.id)).status).toBe(CoachStatus.ACTIVE);
      expect((await reloadCoach(bravo.coach.id)).status).toBe(CoachStatus.ACTIVE);
      expect((await reloadUser(alpha.user.id)).status).toBe(AccountStatus.ACTIVE);
    });

    it('answers 401 without a token', async () => {
      const res = await request(app)
        .patch(`${COACHES_URL}/${alpha.coach.id}/status`)
        .send({ status: CoachStatus.INACTIVE });

      expect(res.status).toBe(401);
    });

    it('still lets an ADMIN change the status', async () => {
      const { coach } = await testData.createCoach();

      const res = await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(CoachStatus.INACTIVE);
    });
  });
});
