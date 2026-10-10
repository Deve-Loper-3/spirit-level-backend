const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { hashPassword } = require('../../src/utils/password.util');
const { verifyAccessToken } = require('../../src/utils/jwt.util');
const { hashToken } = require('../../src/utils/token.util');
const { toPublicUser } = require('../../src/repositories/user.mapper');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction, LoginFailureReason } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(30000);

const LOGIN_URL = '/api/v1/auth/login';
const PASSWORD = 'Password123';
const WRONG_PASSWORD = 'WrongPassword456';
const USER_AGENT = 'jest-login-test/1.0';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

describe('POST /api/v1/auth/login', () => {
  const testData = createTestData('login');
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

  const login = (body) => request(app).post(LOGIN_URL).set('User-Agent', USER_AGENT).send(body);

  const createMember = (overrides = {}) => testData.createUser({ passwordHash, ...overrides });

  const findLogs = (email, action) => prisma.auditLog.findMany({ where: { email, action } });

  describe('successful login', () => {
    it('returns 200 with the public user and tokens in the standard response format', async () => {
      const user = await createMember();

      const res = await login({ email: user.email, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: Messages.LOGIN_SUCCESS });
      expect(res.body.data.user).toEqual(JSON.parse(JSON.stringify(toPublicUser(user))));
    });

    it('returns a valid access token and a refresh token with the configured expiry', async () => {
      const user = await createMember();

      const res = await login({ email: user.email, password: PASSWORD });

      const { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt } =
        res.body.data.tokens;
      expect(verifyAccessToken(accessToken)).toMatchObject({
        sub: user.id,
        role: user.role,
        type: 'access',
      });
      expect(accessTokenExpiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);
      expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const msUntilExpiry = new Date(refreshTokenExpiresAt).getTime() - Date.now();
      const expectedMs = env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY;
      expect(msUntilExpiry).toBeLessThanOrEqual(expectedMs);
      expect(msUntilExpiry).toBeGreaterThan(expectedMs - ONE_MINUTE_MS);
    });

    it('never returns the password hash', async () => {
      const user = await createMember();

      const res = await login({ email: user.email, password: PASSWORD });

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain(passwordHash);
    });

    it('accepts a differently cased and padded email', async () => {
      const user = await createMember();

      const res = await login({ email: `  ${user.email.toUpperCase()}  `, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(user.id);
    });

    it('updates lastLoginAt', async () => {
      const user = await createMember();
      expect(user.lastLoginAt).toBeNull();

      await login({ email: user.email, password: PASSWORD });

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(Date.now() - stored.lastLoginAt.getTime()).toBeLessThan(ONE_MINUTE_MS);
    });

    it('stores only the hash of the refresh token, with ip and user agent', async () => {
      const user = await createMember();

      const res = await login({ email: user.email, password: PASSWORD });

      const { refreshToken } = res.body.data.tokens;
      const sessions = await prisma.refreshSession.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).toBe(hashToken(refreshToken));
      expect(JSON.stringify(sessions[0])).not.toContain(refreshToken);
      expect(sessions[0].userAgent).toBe(USER_AGENT);
      expect(sessions[0].ipAddress).toEqual(expect.any(String));
    });

    it('writes a LOGIN_SUCCESS audit row', async () => {
      const user = await createMember();

      await login({ email: user.email, password: PASSWORD });

      const logs = await findLogs(user.email, AuditAction.LOGIN_SUCCESS);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ userId: user.id, reason: null, userAgent: USER_AGENT });
    });
  });

  describe('invalid credentials', () => {
    it('returns 401 for a wrong password and records INVALID_CREDENTIALS against the user', async () => {
      const user = await createMember();

      const res = await login({ email: user.email, password: WRONG_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_CREDENTIALS });
      const logs = await findLogs(user.email, AuditAction.LOGIN_FAILED);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: user.id,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
        userAgent: USER_AGENT,
      });
    });

    it('returns the identical response for an unknown email and records the attempted email', async () => {
      const user = await createMember();
      const unknownEmail = testData.newEmail();

      const wrongPassword = await login({ email: user.email, password: WRONG_PASSWORD });
      const unknown = await login({ email: unknownEmail, password: WRONG_PASSWORD });

      expect(unknown.status).toBe(wrongPassword.status);
      expect(unknown.body).toEqual(wrongPassword.body);
      const logs = await findLogs(unknownEmail, AuditAction.LOGIN_FAILED);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: null,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      });
    });

    it('creates no session and does not touch lastLoginAt on failure', async () => {
      const user = await createMember();

      await login({ email: user.email, password: WRONG_PASSWORD });

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored.lastLoginAt).toBeNull();
      expect(await prisma.refreshSession.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe('account status', () => {
    it('returns 403 REGISTRATION_INCOMPLETE for a PENDING account and records ACCOUNT_PENDING', async () => {
      const user = await createMember({ status: AccountStatus.PENDING });

      const res = await login({ email: user.email, password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.REGISTRATION_INCOMPLETE });
      const logs = await findLogs(user.email, AuditAction.LOGIN_FAILED);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: user.id,
        reason: LoginFailureReason.ACCOUNT_PENDING,
      });
      expect(await prisma.refreshSession.count({ where: { userId: user.id } })).toBe(0);
    });

    it('returns 403 ACCOUNT_DISABLED for a DISABLED account and records ACCOUNT_DISABLED', async () => {
      const user = await createMember({ status: AccountStatus.DISABLED });

      const res = await login({ email: user.email, password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.ACCOUNT_DISABLED });
      const logs = await findLogs(user.email, AuditAction.LOGIN_FAILED);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: user.id,
        reason: LoginFailureReason.ACCOUNT_DISABLED,
      });
      expect(await prisma.refreshSession.count({ where: { userId: user.id } })).toBe(0);
    });

    it('returns 401, not the status error, for a wrong password on a non-active account', async () => {
      const user = await createMember({ status: AccountStatus.DISABLED });

      const res = await login({ email: user.email, password: WRONG_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_CREDENTIALS });
    });
  });

  describe('validation', () => {
    it.each([
      ['an empty body', {}],
      ['an invalid email', { email: 'not-an-email', password: PASSWORD }],
      ['a missing password', { email: 'member@test.invalid' }],
      ['an empty password', { email: 'member@test.invalid', password: '' }],
      ['a non-string password', { email: 'member@test.invalid', password: 12345678 }],
    ])('returns 400 for %s and writes no audit row', async (_label, body) => {
      const res = await login(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, message: Messages.VALIDATION_FAILED });
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(await prisma.auditLog.count({ where: { email: 'member@test.invalid' } })).toBe(0);
    });
  });
});
