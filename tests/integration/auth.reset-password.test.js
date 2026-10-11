const crypto = require('crypto');
const request = require('supertest');

// No real emails: every SMTP send goes to this mock.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

// Calls the real createAuditLog unless a test makes it fail (rollback test).
jest.mock('../../src/repositories/audit-log.repository', () => {
  const actual = jest.requireActual('../../src/repositories/audit-log.repository');
  return { ...actual, createAuditLog: jest.fn(actual.createAuditLog) };
});

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { hashPassword } = require('../../src/utils/password.util');
const { hashToken } = require('../../src/utils/token.util');
const { createOtp } = require('../../src/repositories/password-reset.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { AppErrors } = require('../../src/constants/errors');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(60000);

const BASE_URL = '/api/v1/auth';
const USER_AGENT = 'jest-reset-password-test/1.0';
const OLD_PASSWORD = 'OldPassw0rd';
const NEW_PASSWORD = 'NewPassw0rd';
const OTP_IN_EMAIL = /reset code is: (\d{4})/;

describe('POST /api/v1/auth/reset-password', () => {
  const testData = createTestData('reset_password');
  let app;
  let oldPasswordHash;

  beforeAll(async () => {
    app = createApp();
    oldPasswordHash = await hashPassword(OLD_PASSWORD);
  });

  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const post = (path, body) =>
    request(app).post(`${BASE_URL}${path}`).set('User-Agent', USER_AGENT).send(body);

  const reset = (body) => post('/reset-password', body);

  const createUser = (overrides = {}) =>
    testData.createUser({ passwordHash: oldPasswordHash, ...overrides });

  const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

  // OTP row that is already verified. Returns the row plus its plain `resetToken`
  // (resetTokenHash is unique, so every row needs its own token).
  const createVerifiedOtp = async (user, overrides = {}) => {
    const otp = await createOtp(prisma, {
      userId: user.id,
      otpHash: 'not-checked-in-this-step',
      expiresAt: minutesFromNow(env.OTP_EXPIRY_MINUTES),
    });
    const resetToken = crypto.randomUUID();
    const row = await prisma.passwordResetOtp.update({
      where: { id: otp.id },
      data: { verifiedAt: new Date(), resetTokenHash: hashToken(resetToken), ...overrides },
    });
    return { ...row, resetToken };
  };

  const createSession = (user) =>
    prisma.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: hashToken(crypto.randomUUID()),
        expiresAt: minutesFromNow(60),
      },
    });

  const reloadUser = (user) => prisma.user.findUnique({ where: { id: user.id } });
  const reloadOtp = (otp) => prisma.passwordResetOtp.findUnique({ where: { id: otp.id } });
  const reloadSession = (session) =>
    prisma.refreshSession.findUnique({ where: { id: session.id } });

  const login = (user, password) =>
    request(app)
      .post(`${BASE_URL}/login`)
      .set('User-Agent', USER_AGENT)
      .send({ email: user.email, password });

  const waitForEmail = async () => {
    for (let i = 0; i < 50 && mockSendMail.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    return mockSendMail.mock.calls[0][0];
  };

  const expectErrorBody = (res, status, appError) => {
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, message: appError.message });
  };

  describe('full flow: forgot-password -> verify-otp -> reset-password', () => {
    it('changes the password, revokes sessions, uses the OTP and audits the reset', async () => {
      const user = await createUser({ mustChangePassword: true });
      const loggedIn = await login(user, OLD_PASSWORD);
      expect(loggedIn.status).toBe(200);
      const session = await prisma.refreshSession.findFirst({ where: { userId: user.id } });
      expect(session.revokedAt).toBeNull();

      await post('/forgot-password', { email: user.email });
      const otp = (await waitForEmail()).text.match(OTP_IN_EMAIL)[1];
      const verified = await post('/verify-otp', { email: user.email, otp });
      expect(verified.status).toBe(200);
      const { resetToken } = verified.body.data;

      const res = await reset({ email: user.email, resetToken, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: Messages.PASSWORD_RESET_SUCCESS,
        data: null,
      });

      expect((await login(user, NEW_PASSWORD)).status).toBe(200);
      expect((await login(user, OLD_PASSWORD)).status).toBe(401);

      const updated = await reloadUser(user);
      expect(updated.mustChangePassword).toBe(false);
      expect(updated.passwordHash).not.toContain(NEW_PASSWORD);

      expect((await reloadSession(session)).revokedAt).not.toBeNull();
      const row = await prisma.passwordResetOtp.findFirst({ where: { userId: user.id } });
      expect(row.usedAt).not.toBeNull();

      const audit = await prisma.auditLog.findMany({
        where: { userId: user.id, action: AuditAction.PASSWORD_RESET_COMPLETED },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ email: user.email, userAgent: USER_AGENT });
      const auditText = JSON.stringify(audit[0]);
      expect(auditText).not.toContain(NEW_PASSWORD);
      expect(auditText).not.toContain(resetToken);
    });

    it('rejects the same reset token a second time and keeps the new password', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user);
      const first = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });

      const second = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: 'AnotherPassw0rd',
      });

      expect(first.status).toBe(200);
      expectErrorBody(second, 400, AppErrors.OTP_ALREADY_USED);
      expect((await login(user, NEW_PASSWORD)).status).toBe(200);
    });

    it('lets exactly one of two parallel resets with the same token succeed', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user);
      const session = await createSession(user);
      const body = (newPassword) => ({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword,
      });

      const results = await Promise.all([
        reset(body('FirstPassw0rd')),
        reset(body('SecondPassw0rd')),
      ]);

      const winnerIndex = results.findIndex((res) => res.status === 200);
      const loser = results[1 - winnerIndex];
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expectErrorBody(loser, 400, AppErrors.OTP_ALREADY_USED);

      const winnerPassword = winnerIndex === 0 ? 'FirstPassw0rd' : 'SecondPassw0rd';
      const loserPassword = winnerIndex === 0 ? 'SecondPassw0rd' : 'FirstPassw0rd';
      expect((await login(user, winnerPassword)).status).toBe(200);
      expect((await login(user, loserPassword)).status).toBe(401);
      expect((await reloadSession(session)).revokedAt).not.toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { userId: user.id, action: AuditAction.PASSWORD_RESET_COMPLETED },
        }),
      ).toBe(1);
    });

    it('revokes only active sessions and leaves already revoked ones untouched', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user);
      const active = await createSession(user);
      const revokedAt = new Date('2026-01-01T00:00:00Z');
      const alreadyRevoked = await prisma.refreshSession.update({
        where: { id: (await createSession(user)).id },
        data: { revokedAt },
      });

      await reset({ email: user.email, resetToken: otp.resetToken, newPassword: NEW_PASSWORD });

      expect((await reloadSession(active)).revokedAt).not.toBeNull();
      expect((await reloadSession(alreadyRevoked)).revokedAt).toEqual(revokedAt);
    });
  });

  describe('rejected resets leave everything unchanged', () => {
    const expectUntouched = async (user, otp, session) => {
      expect((await reloadUser(user)).passwordHash).toBe(oldPasswordHash);
      expect((await reloadOtp(otp)).usedAt).toBeNull();
      expect((await reloadSession(session)).revokedAt).toBeNull();
    };

    it('OTP that was never verified: OTP_INVALID, even with a token', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user, { verifiedAt: null });
      const session = await createSession(user);

      const res = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });

      expectErrorBody(res, 400, AppErrors.OTP_INVALID);
      await expectUntouched(user, otp, session);
    });

    it('wrong reset token: OTP_INVALID', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user);
      const session = await createSession(user);

      const res = await reset({
        email: user.email,
        resetToken: 'some-other-token',
        newPassword: NEW_PASSWORD,
      });

      expectErrorBody(res, 400, AppErrors.OTP_INVALID);
      await expectUntouched(user, otp, session);
    });

    it('expired OTP: OTP_EXPIRED', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user, { expiresAt: minutesFromNow(-1) });
      const session = await createSession(user);

      const res = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });

      expectErrorBody(res, 400, AppErrors.OTP_EXPIRED);
      await expectUntouched(user, otp, session);
    });

    it('invalidated OTP (a newer one was requested): OTP_INVALID', async () => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user, { invalidatedAt: new Date() });
      const session = await createSession(user);

      const res = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });

      expectErrorBody(res, 400, AppErrors.OTP_INVALID);
      await expectUntouched(user, otp, session);
    });

    it.each([AccountStatus.DISABLED, AccountStatus.PENDING])(
      '%s user: same response as a wrong token, password unchanged',
      async (status) => {
        const active = await createUser();
        await createVerifiedOtp(active);
        const user = await createUser({ status });
        const otp = await createVerifiedOtp(user);
        const session = await createSession(user);

        const wrongToken = await reset({
          email: active.email,
          resetToken: 'some-other-token',
          newPassword: NEW_PASSWORD,
        });
        const res = await reset({
          email: user.email,
          resetToken: otp.resetToken,
          newPassword: NEW_PASSWORD,
        });

        expect(res.status).toBe(wrongToken.status);
        expect(res.text).toBe(wrongToken.text);
        await expectUntouched(user, otp, session);
      },
    );

    it('unknown email: same response as a wrong token', async () => {
      const user = await createUser();
      await createVerifiedOtp(user);

      const wrongToken = await reset({
        email: user.email,
        resetToken: 'some-other-token',
        newPassword: NEW_PASSWORD,
      });
      const unknown = await reset({
        email: testData.newEmail(),
        resetToken: 'some-other-token',
        newPassword: NEW_PASSWORD,
      });

      expect(unknown.status).toBe(wrongToken.status);
      expect(unknown.text).toBe(wrongToken.text);
    });

    it('rolls back everything when the audit write fails', async () => {
      const user = await createUser({ mustChangePassword: true });
      const otp = await createVerifiedOtp(user);
      const session = await createSession(user);
      createAuditLog.mockRejectedValueOnce(new Error('audit write failed'));

      const res = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(500);
      await expectUntouched(user, otp, session);
      expect((await reloadUser(user)).mustChangePassword).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { userId: user.id, action: AuditAction.PASSWORD_RESET_COMPLETED },
        }),
      ).toBe(0);
    });
  });

  describe('refresh sessions after a reset', () => {
    const refresh = (refreshToken) =>
      request(app).post(`${BASE_URL}/refresh`).send({ refreshToken });

    const resetFor = async (user) => {
      const otp = await createVerifiedOtp(user);
      return reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
      });
    };

    it('old refresh tokens of every device are rejected and all sessions are revoked', async () => {
      const user = await createUser();
      const phone = (await login(user, OLD_PASSWORD)).body.data.tokens;
      const laptop = (await login(user, OLD_PASSWORD)).body.data.tokens;
      const tablet = (await login(user, OLD_PASSWORD)).body.data.tokens;
      const other = await createUser();
      const otherTokens = (await login(other, OLD_PASSWORD)).body.data.tokens;

      expect((await resetFor(user)).status).toBe(200);

      for (const tokens of [phone, laptop, tablet]) {
        const res = await refresh(tokens.refreshToken);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
      }
      const sessions = await prisma.refreshSession.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
      // Another user's session is untouched and still refreshes.
      expect((await refresh(otherTokens.refreshToken)).status).toBe(200);
    });

    it('the session revoked by the reset gets the transaction time, an earlier revokedAt is kept', async () => {
      const user = await createUser();
      await login(user, OLD_PASSWORD);
      await login(user, OLD_PASSWORD);
      const [first] = await prisma.refreshSession.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      const earlier = new Date('2026-01-01T00:00:00Z');
      await prisma.refreshSession.update({ where: { id: first.id }, data: { revokedAt: earlier } });

      await resetFor(user);

      const sessions = await prisma.refreshSession.findMany({ where: { userId: user.id } });
      expect(sessions.find((s) => s.id === first.id).revokedAt).toEqual(earlier);
      expect(sessions.filter((s) => s.id !== first.id).every((s) => s.revokedAt > earlier)).toBe(
        true,
      );
    });

    it('a new login after the reset gets a session that refreshes normally', async () => {
      const user = await createUser();
      await login(user, OLD_PASSWORD);
      await resetFor(user);

      const relogin = await login(user, NEW_PASSWORD);

      expect(relogin.status).toBe(200);
      expect((await refresh(relogin.body.data.tokens.refreshToken)).status).toBe(200);
    });
  });

  describe('validation', () => {
    it.each([
      ['weak password (no uppercase)', { newPassword: 'newpassw0rd' }],
      ['weak password (too short)', { newPassword: 'Ab1' }],
      ['password longer than 72 characters', { newPassword: `Aa1${'x'.repeat(70)}` }],
      ['missing password', { newPassword: undefined }],
      ['missing reset token', { resetToken: undefined }],
      ['blank reset token', { resetToken: '   ' }],
      ['invalid email', { email: 'nope' }],
    ])('%s: 400 and nothing changes', async (_label, overrides) => {
      const user = await createUser();
      const otp = await createVerifiedOtp(user);

      const res = await reset({
        email: user.email,
        resetToken: otp.resetToken,
        newPassword: NEW_PASSWORD,
        ...overrides,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect((await reloadUser(user)).passwordHash).toBe(oldPasswordHash);
      expect((await reloadOtp(otp)).usedAt).toBeNull();
    });
  });
});
