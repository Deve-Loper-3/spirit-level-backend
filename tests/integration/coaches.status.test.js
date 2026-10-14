const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { hashPassword } = require('../../src/utils/password.util');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { CoachStatus } = require('../../src/constants/coach');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(60000);

const COACHES_URL = '/api/v1/coaches';
const LOGIN_URL = '/api/v1/auth/login';
const REFRESH_URL = '/api/v1/auth/refresh';
const ME_URL = '/api/v1/auth/me';
const PASSWORD = 'Password123';
const USER_AGENT = 'jest-coach-status-test/1.0';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('PATCH /api/v1/coaches/:coachId/status', () => {
  const testData = createTestData('coaches_status');
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
    testData.createCoach({ user: { passwordHash, ...user }, coach });

  const setStatus = (caller, coachId, body) =>
    request(app)
      .patch(`${COACHES_URL}/${coachId}/status`)
      .set('Authorization', bearerFor(caller))
      .set('User-Agent', USER_AGENT)
      .send(body);

  const login = (email) => request(app).post(LOGIN_URL).send({ email, password: PASSWORD });

  const reloadUser = (id) => prisma.user.findUnique({ where: { id } });
  const reloadCoach = (id) => prisma.coach.findUnique({ where: { id } });
  const sessionsOf = (userId) => prisma.refreshSession.findMany({ where: { userId } });
  const statusAudits = (userId) =>
    prisma.auditLog.findMany({
      where: { userId, action: AuditAction.COACH_STATUS_CHANGED },
      orderBy: { createdAt: 'asc' },
    });

  describe('deactivating (INACTIVE)', () => {
    it('sets the coach INACTIVE and the linked user DISABLED, and returns the full view', async () => {
      const { user, coach } = await seedCoach();

      const res = await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.COACH_STATUS_UPDATED_SUCCESS,
        data: { id: coach.id, userId: user.id, status: CoachStatus.INACTIVE },
      });
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.INACTIVE);
      expect((await reloadUser(user.id)).status).toBe(AccountStatus.DISABLED);
      expect(Object.keys(res.body.data).sort()).toEqual(
        [
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
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tempPassword|"role"/i);
    });

    it('revokes every active refresh session, keeps earlier revocations and spares other users', async () => {
      const { user, coach } = await seedCoach();
      const other = await seedCoach();
      await login(user.email);
      await login(user.email);
      await login(other.user.email);
      const [first] = await sessionsOf(user.id);
      const earlier = new Date('2026-01-01T00:00:00.000Z');
      await prisma.refreshSession.update({ where: { id: first.id }, data: { revokedAt: earlier } });

      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      const sessions = await sessionsOf(user.id);
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
      expect(sessions.find((s) => s.id === first.id).revokedAt).toEqual(earlier);
      const otherSessions = await sessionsOf(other.user.id);
      expect(otherSessions.every((s) => s.revokedAt === null)).toBe(true);
    });

    it('blocks the coach: access token, refresh token and login all stop working', async () => {
      const { user, coach } = await seedCoach();
      const loggedIn = await login(user.email);
      const { accessToken, refreshToken } = loggedIn.body.data.tokens;

      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      const me = await request(app).get(ME_URL).set('Authorization', `Bearer ${accessToken}`);
      const refreshed = await request(app).post(REFRESH_URL).send({ refreshToken });
      const relogin = await login(user.email);
      expect(me.status).toBe(403);
      expect(me.body.code).toBe(AppErrors.ACCOUNT_DISABLED.code);
      expect(refreshed.status).toBe(401);
      expect(relogin.status).toBe(403);
      expect(relogin.body.code).toBe(AppErrors.ACCOUNT_DISABLED.code);
    });

    it('writes one COACH_STATUS_CHANGED audit row with actor, meta and ACTIVE->INACTIVE', async () => {
      const { user, coach } = await seedCoach();

      await setStatus(owner, coach.id, { status: CoachStatus.INACTIVE });

      const logs = await statusAudits(user.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        reason: 'ACTIVE->INACTIVE',
        email: user.email,
        actorId: owner.id,
        actorRole: Role.OWNER,
        userAgent: USER_AGENT,
      });
      expect(logs[0].ipAddress).not.toBeNull();
    });
  });

  describe('reactivating (ACTIVE)', () => {
    it('sets the coach ACTIVE and the user ACTIVE again, so login works', async () => {
      const { user, coach } = await seedCoach();
      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      const res = await setStatus(admin, coach.id, { status: CoachStatus.ACTIVE });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(CoachStatus.ACTIVE);
      expect((await reloadUser(user.id)).status).toBe(AccountStatus.ACTIVE);
      expect((await login(user.email)).status).toBe(200);
      const logs = await statusAudits(user.id);
      expect(logs.map((l) => l.reason)).toEqual(['ACTIVE->INACTIVE', 'INACTIVE->ACTIVE']);
    });

    it('does not bring the old sessions back', async () => {
      const { user, coach } = await seedCoach();
      const loggedIn = await login(user.email);
      const { refreshToken } = loggedIn.body.data.tokens;
      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });
      await setStatus(admin, coach.id, { status: CoachStatus.ACTIVE });

      const refreshed = await request(app).post(REFRESH_URL).send({ refreshToken });

      expect(refreshed.status).toBe(401);
    });

    it('lets a deactivated coach created INACTIVE be activated', async () => {
      const { user, coach } = await seedCoach({
        user: { status: AccountStatus.DISABLED },
        coach: { status: CoachStatus.INACTIVE },
      });

      const res = await setStatus(admin, coach.id, { status: CoachStatus.ACTIVE });

      expect(res.status).toBe(200);
      expect((await reloadUser(user.id)).status).toBe(AccountStatus.ACTIVE);
    });
  });

  describe('idempotency', () => {
    it('answers 200 for a repeated INACTIVE and writes one audit row only', async () => {
      const { user, coach } = await seedCoach();

      const first = await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });
      const second = await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data).toEqual(first.body.data);
      expect(await statusAudits(user.id)).toHaveLength(1);
      expect((await reloadUser(user.id)).status).toBe(AccountStatus.DISABLED);
    });

    it('answers 200 and changes nothing when an ACTIVE coach is set ACTIVE', async () => {
      const { user, coach } = await seedCoach();
      await login(user.email);

      const res = await setStatus(admin, coach.id, { status: CoachStatus.ACTIVE });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(CoachStatus.ACTIVE);
      expect(await statusAudits(user.id)).toHaveLength(0);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt === null)).toBe(true);
      expect((await reloadCoach(coach.id)).updatedAt).toEqual(coach.updatedAt);
    });

    it('does not revoke sessions created after the coach was already INACTIVE', async () => {
      const { user, coach } = await seedCoach();
      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });
      const session = await prisma.refreshSession.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          tokenHash: `hash_${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });

      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      const reloaded = await prisma.refreshSession.findUnique({ where: { id: session.id } });
      expect(reloaded.revokedAt).toBeNull();
    });
  });

  describe('linked user in another status', () => {
    it('never touches a PENDING user, in either direction', async () => {
      const { user, coach } = await seedCoach({ user: { status: AccountStatus.PENDING } });

      const deactivated = await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });
      const afterDeactivate = await reloadUser(user.id);
      const reactivated = await setStatus(admin, coach.id, { status: CoachStatus.ACTIVE });
      const afterReactivate = await reloadUser(user.id);

      expect(deactivated.status).toBe(200);
      expect(deactivated.body.data.status).toBe(CoachStatus.INACTIVE);
      expect(afterDeactivate.status).toBe(AccountStatus.PENDING);
      expect(reactivated.body.data.status).toBe(CoachStatus.ACTIVE);
      expect(afterReactivate.status).toBe(AccountStatus.PENDING);
    });

    it('does not turn an already DISABLED user ACTIVE when deactivating', async () => {
      const { user, coach } = await seedCoach({ user: { status: AccountStatus.DISABLED } });

      await setStatus(admin, coach.id, { status: CoachStatus.INACTIVE });

      expect((await reloadUser(user.id)).status).toBe(AccountStatus.DISABLED);
    });
  });

  describe('validation', () => {
    it.each([
      ['missing status', {}],
      ['status DISABLED', { status: 'DISABLED' }],
      ['status lower case', { status: 'active' }],
      ['status null', { status: null }],
      ['status empty', { status: '' }],
    ])('returns 400 VALIDATION_ERROR for %s and changes nothing', async (_label, body) => {
      const { user, coach } = await seedCoach();

      const res = await setStatus(admin, coach.id, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        message: Messages.VALIDATION_FAILED,
        code: AppErrors.VALIDATION_ERROR.code,
      });
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
      expect((await reloadUser(user.id)).status).toBe(AccountStatus.ACTIVE);
    });

    it.each([
      ['bio', 'x'],
      ['role', Role.OWNER],
      ['fullName', 'Sneaky'],
    ])('returns 400 when the body also has %s', async (field, value) => {
      const { coach } = await seedCoach();

      const res = await setStatus(admin, coach.id, {
        status: CoachStatus.INACTIVE,
        [field]: value,
      });

      expect(res.status).toBe(400);
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
    });

    it('returns 400 for a malformed coach id', async () => {
      const res = await setStatus(admin, 'not-a-uuid', { status: CoachStatus.ACTIVE });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('coachId');
    });
  });

  describe('not found, authentication and authorization', () => {
    it('returns 404 COACH_NOT_FOUND for an unknown id', async () => {
      const res = await setStatus(admin, MISSING_ID, { status: CoachStatus.INACTIVE });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        message: Messages.COACH_NOT_FOUND,
        code: AppErrors.COACH_NOT_FOUND.code,
      });
    });

    it('returns 401 without a token', async () => {
      const { coach } = await seedCoach();

      const res = await request(app)
        .patch(`${COACHES_URL}/${coach.id}/status`)
        .send({ status: CoachStatus.INACTIVE });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(AppErrors.UNAUTHORIZED.code);
    });

    it.each([Role.COACH, Role.MEMBER])(
      'returns 403 FORBIDDEN for a %s and changes nothing',
      async (role) => {
        const { user, coach } = await seedCoach();
        const caller = await testData.createUser({ role });

        const res = await setStatus(caller, coach.id, { status: CoachStatus.INACTIVE });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          success: false,
          message: Messages.FORBIDDEN,
          code: AppErrors.FORBIDDEN.code,
        });
        expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
        expect((await reloadUser(user.id)).status).toBe(AccountStatus.ACTIVE);
      },
    );

    it('returns 403 for a coach deactivating themselves', async () => {
      const { user, coach } = await seedCoach();

      const res = await setStatus(user, coach.id, { status: CoachStatus.INACTIVE });

      expect(res.status).toBe(403);
      expect((await reloadCoach(coach.id)).status).toBe(CoachStatus.ACTIVE);
    });

    it('has no DELETE route: a coach cannot be removed', async () => {
      const { coach } = await seedCoach();

      const res = await request(app)
        .delete(`${COACHES_URL}/${coach.id}`)
        .set('Authorization', bearerFor(admin));

      expect(res.status).toBe(404);
      expect(await reloadCoach(coach.id)).not.toBeNull();
    });
  });
});
