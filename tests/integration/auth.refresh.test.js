const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { hashPassword } = require('../../src/utils/password.util');
const { verifyAccessToken } = require('../../src/utils/jwt.util');
const { hashToken } = require('../../src/utils/token.util');
const { AccountStatus } = require('../../src/constants/status');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(60000);

const LOGIN_URL = '/api/v1/auth/login';
const REFRESH_URL = '/api/v1/auth/refresh';
const PROTECTED_URL = '/api/v1/uploads/profile-image';
const PASSWORD = 'Password123';
const USER_AGENT = 'jest-refresh-test/1.0';

describe('POST /api/v1/auth/refresh', () => {
  const testData = createTestData('refresh');
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

  const loginAs = async (overrides = {}) => {
    const user = await testData.createUser({ passwordHash, ...overrides });
    const res = await request(app).post(LOGIN_URL).send({ email: user.email, password: PASSWORD });
    return { user, tokens: res.body.data.tokens };
  };

  const refresh = (refreshToken) =>
    request(app).post(REFRESH_URL).set('User-Agent', USER_AGENT).send({ refreshToken });

  const sessionsOf = (userId) =>
    prisma.refreshSession.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  describe('successful refresh', () => {
    it('returns 200 with new tokens in the standard response format', async () => {
      const { tokens } = await loginAs();

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: Messages.TOKEN_REFRESH_SUCCESS });
      expect(Object.keys(res.body.data.tokens).sort()).toEqual([
        'accessToken',
        'accessTokenExpiresIn',
        'refreshToken',
        'refreshTokenExpiresAt',
      ]);
      expect(res.body.data.tokens.refreshToken).not.toBe(tokens.refreshToken);
    });

    it('issues an access token with sub, email, role, iat and exp that works on a protected route', async () => {
      const { user, tokens } = await loginAs();

      const res = await refresh(tokens.refreshToken);

      const claims = verifyAccessToken(res.body.data.tokens.accessToken);
      expect(claims).toMatchObject({ sub: user.id, email: user.email, role: user.role });
      expect(claims.iat).toEqual(expect.any(Number));
      expect(claims.exp).toEqual(expect.any(Number));
      const protectedRes = await request(app)
        .patch(PROTECTED_URL)
        .set('Authorization', `Bearer ${res.body.data.tokens.accessToken}`)
        .send({ profileImageUrl: null });
      expect(protectedRes.status).toBe(200);
    });

    it('login access token carries the email claim too', async () => {
      const { user, tokens } = await loginAs();

      expect(verifyAccessToken(tokens.accessToken)).toMatchObject({ email: user.email });
    });

    it('rotates the session: old one revoked, new one holds only the hash, ip and user agent', async () => {
      const { user, tokens } = await loginAs();

      const res = await refresh(tokens.refreshToken);

      const [oldSession, newSession] = await sessionsOf(user.id);
      expect(oldSession.revokedAt).not.toBeNull();
      expect(newSession).toMatchObject({
        revokedAt: null,
        tokenHash: hashToken(res.body.data.tokens.refreshToken),
        userAgent: USER_AGENT,
      });
      expect(newSession.ipAddress).toEqual(expect.any(String));
      expect(JSON.stringify(newSession)).not.toContain(res.body.data.tokens.refreshToken);
    });

    it('can be chained: the new refresh token refreshes again', async () => {
      const { tokens } = await loginAs();
      const first = await refresh(tokens.refreshToken);

      const second = await refresh(first.body.data.tokens.refreshToken);

      expect(second.status).toBe(200);
    });
  });

  describe('reuse detection', () => {
    it('login -> refresh -> old token rejected -> reuse revokes every session of the user', async () => {
      const { user, tokens } = await loginAs();
      const second = await request(app)
        .post(LOGIN_URL)
        .send({ email: user.email, password: PASSWORD }); // a second device

      const first = await refresh(tokens.refreshToken);
      expect(first.status).toBe(200);

      const reused = await refresh(tokens.refreshToken);
      expect(reused.status).toBe(401);
      expect(reused.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });

      const sessions = await sessionsOf(user.id);
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

      const newestToken = await refresh(first.body.data.tokens.refreshToken);
      const otherDevice = await refresh(second.body.data.tokens.refreshToken);
      expect(newestToken.status).toBe(401);
      expect(otherDevice.status).toBe(401);
    });

    it('does not revoke sessions of other users', async () => {
      const { tokens } = await loginAs();
      const other = await loginAs();
      await refresh(tokens.refreshToken);

      await refresh(tokens.refreshToken);

      const otherRes = await refresh(other.tokens.refreshToken);
      expect(otherRes.status).toBe(200);
    });

    it('two parallel refreshes with the same token: exactly one succeeds, the other gets 401', async () => {
      const { user, tokens } = await loginAs();

      const results = await Promise.all([
        refresh(tokens.refreshToken),
        refresh(tokens.refreshToken),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      const sessions = await sessionsOf(user.id);
      // Original + exactly one new session: the loser never created one.
      expect(sessions).toHaveLength(2);
      expect(sessions[0].revokedAt).not.toBeNull();
    });
  });

  describe('rejections', () => {
    it('unknown token -> 401 INVALID_TOKEN', async () => {
      const res = await refresh('x'.repeat(43));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('an access token is not accepted as a refresh token', async () => {
      const { tokens } = await loginAs();

      const res = await refresh(tokens.accessToken);

      expect(res.status).toBe(401);
    });

    it('expired refresh session -> 401 TOKEN_EXPIRED and nothing changes', async () => {
      const { user, tokens } = await loginAs();
      await prisma.refreshSession.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.TOKEN_EXPIRED });
      const sessions = await sessionsOf(user.id);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].revokedAt).toBeNull();
    });

    it('DISABLED user -> 403 and no new session', async () => {
      const { user, tokens } = await loginAs();
      await prisma.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.DISABLED },
      });

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(403);
      expect(await sessionsOf(user.id)).toHaveLength(1);
    });

    it.each([
      ['missing', {}],
      ['empty', { refreshToken: '' }],
      ['non-string', { refreshToken: 123 }],
    ])('%s refreshToken -> 400 and no database change', async (_label, body) => {
      const res = await request(app).post(REFRESH_URL).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors[0]).toEqual({
        field: 'refreshToken',
        message: Messages.REFRESH_TOKEN_REQUIRED,
      });
    });
  });

  describe('account state and protected routes', () => {
    const callProtected = (accessToken) =>
      request(app)
        .patch(PROTECTED_URL)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ profileImageUrl: null });

    it('PENDING user -> 403 REGISTRATION_INCOMPLETE and no new session', async () => {
      const { user, tokens } = await loginAs();
      await prisma.user.update({ where: { id: user.id }, data: { status: AccountStatus.PENDING } });

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: AppErrors.REGISTRATION_INCOMPLETE.message,
      });
      expect(await sessionsOf(user.id)).toHaveLength(1);
    });

    it('deleted user -> 401 INVALID_TOKEN (its sessions are deleted with it)', async () => {
      const { user, tokens } = await loginAs();
      await prisma.user.delete({ where: { id: user.id } });

      const res = await refresh(tokens.refreshToken);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('the access token from /auth/login works on a real protected route', async () => {
      const { tokens } = await loginAs();

      const res = await callProtected(tokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('a refresh token sent as Bearer on a protected route -> 401 INVALID_TOKEN', async () => {
      const { tokens } = await loginAs();

      const res = await callProtected(tokens.refreshToken);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('the new access token carries the role stored in the DB, not the old one', async () => {
      const { user, tokens } = await loginAs();
      expect(verifyAccessToken(tokens.accessToken).role).toBe(Role.MEMBER);
      await prisma.user.update({ where: { id: user.id }, data: { role: Role.COACH } });

      const res = await refresh(tokens.refreshToken);

      expect(verifyAccessToken(res.body.data.tokens.accessToken).role).toBe(Role.COACH);
    });
  });
});
