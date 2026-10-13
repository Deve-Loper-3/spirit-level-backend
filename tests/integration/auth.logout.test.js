const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { hashPassword } = require('../../src/utils/password.util');
const { AuditAction } = require('../../src/constants/audit');
const { AccountStatus } = require('../../src/constants/status');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(60000);

const LOGIN_URL = '/api/v1/auth/login';
const REFRESH_URL = '/api/v1/auth/refresh';
const LOGOUT_URL = '/api/v1/auth/logout';
const PROTECTED_URL = '/api/v1/uploads/profile-image';
const PASSWORD = 'Password123';
const USER_AGENT = 'jest-logout-test/1.0';
const SUCCESS_BODY = { success: true, message: Messages.LOGOUT_SUCCESS, data: null };

describe('POST /api/v1/auth/logout', () => {
  const testData = createTestData('logout');
  let app;
  let passwordHash;

  beforeAll(async () => {
    app = createApp();
    passwordHash = await hashPassword(PASSWORD);
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const loginAs = async (user) => {
    const res = await request(app).post(LOGIN_URL).send({ email: user.email, password: PASSWORD });
    return res.body.data.tokens;
  };

  const createUserAndLogin = async () => {
    const user = await testData.createUser({ passwordHash });
    return { user, tokens: await loginAs(user) };
  };

  // Logout needs the access token as Bearer; the refresh token goes in the body.
  const logout = (refreshToken, accessToken) => {
    const req = request(app).post(LOGOUT_URL).set('User-Agent', USER_AGENT);
    if (accessToken) req.set('Authorization', `Bearer ${accessToken}`);
    return req.send({ refreshToken });
  };
  const refresh = (refreshToken) => request(app).post(REFRESH_URL).send({ refreshToken });
  const protectedCall = (accessToken) =>
    request(app)
      .patch(PROTECTED_URL)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ profileImageUrl: null });
  const sessionsOf = (userId) =>
    prisma.refreshSession.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const logoutAudits = (userId) =>
    prisma.auditLog.findMany({ where: { userId, action: AuditAction.LOGOUT } });
  const signAccess = (user, options = {}) =>
    jwt.sign({ email: user.email, role: user.role, type: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: user.id,
      ...options,
    });

  describe('success', () => {
    it('returns 200 in the standard response format and revokes the session', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout(tokens.refreshToken, tokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(SUCCESS_BODY);
      const [session] = await sessionsOf(user.id);
      expect(session.revokedAt).not.toBeNull();
    });

    it('writes exactly one LOGOUT audit row with user, email, ip and user agent', async () => {
      const { user, tokens } = await createUserAndLogin();

      await logout(tokens.refreshToken, tokens.accessToken);

      const rows = await logoutAudits(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: user.id,
        email: user.email,
        userAgent: USER_AGENT,
        reason: null,
      });
      expect(rows[0].ipAddress).toEqual(expect.any(String));
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain(tokens.refreshToken);
      expect(serialized).not.toContain(tokens.accessToken);
    });

    it('refresh with the logged-out token fails with 401', async () => {
      const { tokens } = await createUserAndLogin();
      await logout(tokens.refreshToken, tokens.accessToken);

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('only ends that session: the same user keeps the session of another device', async () => {
      const { user, tokens } = await createUserAndLogin();
      const otherDevice = await loginAs(user);

      await logout(tokens.refreshToken, tokens.accessToken);

      const [first, second] = await sessionsOf(user.id);
      expect(first.revokedAt).not.toBeNull();
      expect(second.revokedAt).toBeNull();
      expect((await refresh(otherDevice.refreshToken)).status).toBe(200);
      expect(await logoutAudits(user.id)).toHaveLength(1);
    });

    it('an expired but not revoked refresh session is still revoked and audited', async () => {
      const { user, tokens } = await createUserAndLogin();
      await prisma.refreshSession.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await logout(tokens.refreshToken, tokens.accessToken);

      expect(res.status).toBe(200);
      expect((await sessionsOf(user.id))[0].revokedAt).not.toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(1);
    });

    it('the current access token stays valid until it expires (documented limit)', async () => {
      const { tokens } = await createUserAndLogin();
      await logout(tokens.refreshToken, tokens.accessToken);

      const res = await protectedCall(tokens.accessToken);

      expect(res.status).toBe(200);
    });
  });

  describe('authentication is required', () => {
    it('no Authorization header -> 401, session untouched, no audit row', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout(tokens.refreshToken);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.NO_TOKEN_PROVIDED });
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('garbage access token -> 401 INVALID_TOKEN, session untouched, no audit row', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout(tokens.refreshToken, 'junk.junk.junk');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('expired access token -> 401 TOKEN_EXPIRED, session untouched, no audit row', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout(tokens.refreshToken, signAccess(user, { expiresIn: -10 }));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.TOKEN_EXPIRED });
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('a refresh token sent as the Bearer token -> 401', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout(tokens.refreshToken, tokens.refreshToken);

      expect(res.status).toBe(401);
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
    });

    it('DISABLED user (token issued earlier) -> 403, session untouched, no audit row', async () => {
      const { user, tokens } = await createUserAndLogin();
      await prisma.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.DISABLED },
      });

      const res = await logout(tokens.refreshToken, tokens.accessToken);

      expect(res.status).toBe(403);
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('authentication is checked before the body: bad body without a token -> 401, not 400', async () => {
      const res = await request(app).post(LOGOUT_URL).send({});

      expect(res.status).toBe(401);
    });
  });

  describe('ownership, idempotency and no information leak', () => {
    it("another user's refresh token: same success response, NOT revoked, no audit row", async () => {
      const a = await createUserAndLogin();
      const b = await createUserAndLogin();
      const known = await logout(a.tokens.refreshToken, a.tokens.accessToken);
      const a2 = await loginAs(a.user);

      const res = await logout(b.tokens.refreshToken, a2.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(known.body);
      expect((await sessionsOf(b.user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(b.user.id)).toHaveLength(0);
      expect(await logoutAudits(a.user.id)).toHaveLength(1);
      expect((await refresh(b.tokens.refreshToken)).status).toBe(200);
    });

    it('a second logout with the same token: same success, no extra audit row, revokedAt kept', async () => {
      const { user, tokens } = await createUserAndLogin();
      const first = await logout(tokens.refreshToken, tokens.accessToken);
      const [afterFirst] = await sessionsOf(user.id);

      const second = await logout(tokens.refreshToken, tokens.accessToken);

      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect((await sessionsOf(user.id))[0].revokedAt).toEqual(afterFirst.revokedAt);
      expect(await logoutAudits(user.id)).toHaveLength(1);
    });

    it('logging out a revoked token is not reuse: other sessions stay active', async () => {
      const { user, tokens } = await createUserAndLogin();
      const otherDevice = await loginAs(user);
      await logout(tokens.refreshToken, tokens.accessToken);

      await logout(tokens.refreshToken, tokens.accessToken);

      const sessions = await sessionsOf(user.id);
      expect(sessions.filter((s) => s.revokedAt === null)).toHaveLength(1);
      expect((await refresh(otherDevice.refreshToken)).status).toBe(200);
    });

    it('an unknown token returns the identical success response and writes nothing', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await logout('x'.repeat(43), tokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(SUCCESS_BODY);
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('a stale refresh token after logout triggers reuse detection on /auth/refresh (all sessions revoked)', async () => {
      const { user, tokens } = await createUserAndLogin();
      const otherDevice = await loginAs(user);
      await logout(tokens.refreshToken, tokens.accessToken);

      const stale = await refresh(tokens.refreshToken);

      expect(stale.status).toBe(401);
      expect((await refresh(otherDevice.refreshToken)).status).toBe(401);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
    });
  });

  describe('validation', () => {
    it.each([
      ['missing refreshToken', {}],
      ['empty refreshToken', { refreshToken: '' }],
      ['blank refreshToken', { refreshToken: '   ' }],
      ['non-string refreshToken', { refreshToken: 123 }],
    ])('%s -> 400 in the standard error format', async (_label, body) => {
      const { user, tokens } = await createUserAndLogin();

      const res = await request(app)
        .post(LOGOUT_URL)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        message: Messages.VALIDATION_FAILED,
        errors: [{ field: 'refreshToken', message: Messages.REFRESH_TOKEN_REQUIRED }],
      });
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
      expect(await logoutAudits(user.id)).toHaveLength(0);
    });

    it('a valid access token alone (no body) cannot log out: 400 and nothing revoked', async () => {
      const { user, tokens } = await createUserAndLogin();

      const res = await request(app)
        .post(LOGOUT_URL)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(res.status).toBe(400);
      expect((await sessionsOf(user.id))[0].revokedAt).toBeNull();
    });
  });
});
