// The trusted-image-URL check derives the allowed host from this token.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { hashPassword } = require('../../src/utils/password.util');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { CoachType, CoachStatus } = require('../../src/constants/coach');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(60000);

const COACHES_URL = '/api/v1/coaches';
const LOGIN_URL = '/api/v1/auth/login';
const REFRESH_URL = '/api/v1/auth/refresh';
const PASSWORD = 'Password123';
const USER_AGENT = 'jest-coach-update-test/1.0';
const IMAGE_URL = 'https://teststore.public.blob.vercel-storage.com/profile-images/new.jpg';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('PATCH /api/v1/coaches/:coachId', () => {
  const testData = createTestData('coaches_update');
  let app;
  let admin;
  let owner;
  let passwordHash;

  beforeAll(async () => {
    app = createApp();
    passwordHash = await hashPassword(PASSWORD);
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const seedCoach = ({ user = {}, coach = {} } = {}) =>
    testData.createCoach({
      user: { passwordHash, fullName: 'Original Name', ...user },
      coach: { bio: 'Original bio', ...coach },
    });

  const patch = (caller, coachId, body) =>
    request(app)
      .patch(`${COACHES_URL}/${coachId}`)
      .set('Authorization', bearerFor(caller))
      .set('User-Agent', USER_AGENT)
      .send(body);

  const reloadUser = (id) => prisma.user.findUnique({ where: { id } });
  const reloadCoach = (id) => prisma.coach.findUnique({ where: { id } });
  const countAudits = (userId) =>
    prisma.auditLog.count({ where: { userId, action: AuditAction.COACH_UPDATED } });

  describe('partial update', () => {
    it('updates only bio: the coach row changes, the user row does not', async () => {
      const { user, coach } = await seedCoach();

      const res = await patch(admin, coach.id, { bio: 'New bio' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.COACH_UPDATED_SUCCESS,
        data: { id: coach.id, bio: 'New bio', fullName: 'Original Name', email: user.email },
      });
      expect((await reloadCoach(coach.id)).bio).toBe('New bio');
      const after = await reloadUser(user.id);
      expect(after.fullName).toBe('Original Name');
      expect(after.updatedAt).toEqual(user.updatedAt);
    });

    it('updates only coachType', async () => {
      const { coach } = await seedCoach();

      const res = await patch(owner, coach.id, { coachType: CoachType.FREELANCE });

      expect(res.status).toBe(200);
      expect(res.body.data.coachType).toBe(CoachType.FREELANCE);
      expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
    });

    it('updates user-only fields and still moves the coach updatedAt', async () => {
      const { user, coach } = await seedCoach();

      const res = await patch(admin, coach.id, {
        fullName: 'Brand New Name',
        phone: '+12025550199',
      });

      expect(res.status).toBe(200);
      const after = await reloadUser(user.id);
      expect(after).toMatchObject({ fullName: 'Brand New Name', phone: '+12025550199' });
      expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(
        coach.updatedAt.getTime(),
      );
      expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
    });

    it('updates all six fields at once', async () => {
      const { user, coach } = await seedCoach();
      const email = testData.newEmail();

      const res = await patch(admin, coach.id, {
        fullName: '  Everything New  ',
        email,
        phone: '+12025550123',
        profileImageUrl: IMAGE_URL,
        bio: '  Fresh bio  ',
        coachType: CoachType.FREELANCE,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: coach.id,
        userId: user.id,
        fullName: 'Everything New',
        email,
        phone: '+12025550123',
        profileImageUrl: IMAGE_URL,
        bio: 'Fresh bio',
        coachType: CoachType.FREELANCE,
        status: CoachStatus.ACTIVE,
      });
      expect(await reloadUser(user.id)).toMatchObject({
        fullName: 'Everything New',
        email,
        profileImageUrl: IMAGE_URL,
      });
      expect(await reloadCoach(coach.id)).toMatchObject({
        bio: 'Fresh bio',
        coachType: CoachType.FREELANCE,
      });
    });

    it('clears bio and profileImageUrl with null', async () => {
      const { user, coach } = await seedCoach({ user: { profileImageUrl: IMAGE_URL } });

      const res = await patch(admin, coach.id, { bio: null, profileImageUrl: null });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ bio: null, profileImageUrl: null });
      expect((await reloadUser(user.id)).profileImageUrl).toBeNull();
      expect((await reloadCoach(coach.id)).bio).toBeNull();
    });

    it('never changes role, status or password through an update', async () => {
      const { user, coach } = await seedCoach();

      await patch(admin, coach.id, { fullName: 'Same Account' });

      expect(await reloadUser(user.id)).toMatchObject({
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
        passwordHash,
      });
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
    });

    it('returns the full view without secrets', async () => {
      const { coach } = await seedCoach();

      const res = await patch(admin, coach.id, { bio: 'x' });

      expect(Object.keys(res.body.data).sort()).toEqual(
        [
          'id',
          'userId',
          'fullName',
          'email',
          'phone',
          'profileImageUrl',
          'bio',
          'coachType',
          'status',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|"role"/i);
    });
  });

  describe('email change', () => {
    it('stores the email lower-cased; the new email logs in and the old one no longer does', async () => {
      const { user, coach } = await seedCoach();
      const newEmail = testData.newEmail();

      const res = await patch(admin, coach.id, { email: newEmail.toUpperCase() });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(newEmail.toLowerCase());
      const newLogin = await request(app)
        .post(LOGIN_URL)
        .send({ email: newEmail, password: PASSWORD });
      const oldLogin = await request(app)
        .post(LOGIN_URL)
        .send({ email: user.email, password: PASSWORD });
      expect(newLogin.status).toBe(200);
      expect(oldLogin.status).toBe(401);
    });

    it('revokes the sessions of the coach so old refresh tokens stop working', async () => {
      const { user, coach } = await seedCoach();
      const login = await request(app)
        .post(LOGIN_URL)
        .send({ email: user.email, password: PASSWORD });
      const { refreshToken } = login.body.data.tokens;

      await patch(admin, coach.id, { email: testData.newEmail() });

      const refreshed = await request(app).post(REFRESH_URL).send({ refreshToken });
      expect(refreshed.status).toBe(401);
    });

    it('accepts the coach own current email, also in another case', async () => {
      const { user, coach } = await seedCoach();

      const same = await patch(admin, coach.id, { email: user.email });
      const upper = await patch(admin, coach.id, { email: user.email.toUpperCase() });

      expect(same.status).toBe(200);
      expect(upper.status).toBe(200);
    });

    it.each([Role.MEMBER, Role.COACH, Role.ADMIN])(
      'returns 409 COACH_EMAIL_ALREADY_EXISTS when a %s already uses the email, and changes nothing',
      async (role) => {
        const { user, coach } = await seedCoach();
        const other = await testData.createUser({ role });

        const res = await patch(admin, coach.id, { email: other.email, bio: 'Must not be saved' });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          success: false,
          message: Messages.COACH_EMAIL_ALREADY_EXISTS,
          code: AppErrors.COACH_EMAIL_ALREADY_EXISTS.code,
        });
        expect((await reloadUser(user.id)).email).toBe(user.email);
        expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
        expect(await countAudits(user.id)).toBe(0);
      },
    );

    it('treats a taken email case-insensitively', async () => {
      const { coach } = await seedCoach();
      const other = await testData.createUser({ role: Role.MEMBER });

      const res = await patch(admin, coach.id, { email: other.email.toUpperCase() });

      expect(res.status).toBe(409);
    });

    it('lets exactly one of two parallel updates to the same new email win', async () => {
      const first = await seedCoach();
      const second = await seedCoach();
      const email = testData.newEmail();

      const results = await Promise.all([
        patch(admin, first.coach.id, { email }),
        patch(admin, second.coach.id, { email }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });
  });

  describe('validation', () => {
    it('returns 400 for an empty body and changes nothing', async () => {
      const { coach } = await seedCoach();

      const res = await patch(admin, coach.id, {});

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        message: Messages.VALIDATION_FAILED,
        code: AppErrors.VALIDATION_ERROR.code,
      });
      expect(res.body.errors[0].message).toBe(Messages.COACH_UPDATE_EMPTY);
    });

    it.each([
      [{ status: CoachStatus.INACTIVE }],
      [{ status: CoachStatus.ACTIVE }],
      [{ bio: 'x', status: CoachStatus.INACTIVE }],
    ])('returns 400 when status is in the body %j and changes nothing', async (body) => {
      const { coach } = await seedCoach();

      const res = await patch(admin, coach.id, body);

      expect(res.status).toBe(400);
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
      expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
    });

    it.each([
      ['firstName', 'Sam'],
      ['lastName', 'Coach'],
      ['role', Role.OWNER],
      ['userId', 'abc'],
      ['id', 'abc'],
      ['password', 'Password123'],
      ['salary', 1000],
    ])('returns 400 for the unknown field %s and changes nothing', async (field, value) => {
      const { coach } = await seedCoach();

      const res = await patch(admin, coach.id, { bio: 'Must not be saved', [field]: value });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
      expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
    });

    it.each([
      ['fullName too short', { fullName: 'A' }, 'fullName'],
      ['email invalid', { email: 'not-an-email' }, 'email'],
      ['phone invalid', { phone: '12ab' }, 'phone'],
      ['phone null', { phone: null }, 'phone'],
      ['coachType invalid', { coachType: 'CONTRACTOR' }, 'coachType'],
      ['coachType null', { coachType: null }, 'coachType'],
      ['bio too long', { bio: 'a'.repeat(1001) }, 'bio'],
      ['bio not a string', { bio: 5 }, 'bio'],
      ['image untrusted', { profileImageUrl: 'https://evil.test/a.jpg' }, 'profileImageUrl'],
    ])('returns 400 for %s', async (_label, body, field) => {
      const { coach } = await seedCoach();

      const res = await patch(admin, coach.id, body);

      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    it('returns 400 for a malformed coach id', async () => {
      const res = await patch(admin, 'not-a-uuid', { bio: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0]).toEqual({ field: 'coachId', message: Messages.COACH_ID_INVALID });
    });
  });

  describe('not found', () => {
    it('returns 404 COACH_NOT_FOUND for an unknown id', async () => {
      const res = await patch(admin, MISSING_ID, { bio: 'x' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        message: Messages.COACH_NOT_FOUND,
        code: AppErrors.COACH_NOT_FOUND.code,
      });
    });

    it('returns 404 when the id is a user id', async () => {
      const { user } = await seedCoach();

      const res = await patch(admin, user.id, { bio: 'x' });

      expect(res.status).toBe(404);
    });
  });

  describe('authentication and authorization', () => {
    it('returns 401 without a token', async () => {
      const { coach } = await seedCoach();

      const res = await request(app).patch(`${COACHES_URL}/${coach.id}`).send({ bio: 'x' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(AppErrors.UNAUTHORIZED.code);
    });

    it('returns 401 INVALID_TOKEN for an invalid token', async () => {
      const { coach } = await seedCoach();

      const res = await request(app)
        .patch(`${COACHES_URL}/${coach.id}`)
        .set('Authorization', 'Bearer not-a-jwt')
        .send({ bio: 'x' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(AppErrors.INVALID_TOKEN.code);
    });

    it.each([Role.COACH, Role.MEMBER])(
      'returns 403 FORBIDDEN for a %s who does not own the profile, and changes nothing',
      async (role) => {
        const { coach } = await seedCoach();
        const caller = await testData.createUser({ role });

        const res = await patch(caller, coach.id, { bio: 'Hacked' });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          success: false,
          message: Messages.FORBIDDEN,
          code: AppErrors.FORBIDDEN.code,
        });
        expect((await reloadCoach(coach.id)).bio).toBe('Original bio');
      },
    );

    it.each([
      [AccountStatus.DISABLED, AppErrors.ACCOUNT_DISABLED],
      [AccountStatus.PENDING, AppErrors.REGISTRATION_INCOMPLETE],
    ])('returns 403 for a %s admin', async (status, appError) => {
      const { coach } = await seedCoach();
      const caller = await testData.createUser({ role: Role.ADMIN, status });

      const res = await patch(caller, coach.id, { bio: 'x' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(appError.code);
    });

    it('checks the role before validating the body', async () => {
      const { coach } = await seedCoach();
      const member = await testData.createUser({ role: Role.MEMBER });

      const res = await patch(member, coach.id, { status: 'INACTIVE' });

      expect(res.status).toBe(403);
    });
  });

  describe('audit log', () => {
    it('writes one COACH_UPDATED row with actor, request meta and field NAMES only', async () => {
      const { user, coach } = await seedCoach();
      const newEmail = testData.newEmail();

      await patch(owner, coach.id, {
        fullName: 'Very Secret Name',
        email: newEmail,
        bio: 'Very secret bio',
      });

      const logs = await prisma.auditLog.findMany({
        where: { userId: user.id, action: AuditAction.COACH_UPDATED },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        reason: 'fullName,email,bio',
        email: newEmail.toLowerCase(),
        actorId: owner.id,
        actorRole: Role.OWNER,
        userAgent: USER_AGENT,
      });
      expect(logs[0].ipAddress).not.toBeNull();
      expect(JSON.stringify(logs)).not.toMatch(/Very Secret Name|Very secret bio/);
    });

    it('writes no audit row when the update is rejected', async () => {
      const { user, coach } = await seedCoach();

      await patch(admin, coach.id, { fullName: 'A' });
      await patch(admin, coach.id, {});

      expect(await countAudits(user.id)).toBe(0);
    });
  });

  describe('unrelated data', () => {
    it('does not touch other coaches', async () => {
      const target = await seedCoach();
      const other = await seedCoach();

      await patch(admin, target.coach.id, { fullName: 'Only Target', bio: 'Only target bio' });

      expect((await reloadUser(other.user.id)).fullName).toBe('Original Name');
      expect((await reloadCoach(other.coach.id)).bio).toBe('Original bio');
    });
  });
});
