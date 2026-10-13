const request = require('supertest');

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
const { createOtp, createOtpTx } = require('../../src/repositories/password-reset.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { AppErrors } = require('../../src/constants/errors');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(30000);

const URL = '/api/v1/auth/verify-otp';
const USER_AGENT = 'jest-verify-otp-test/1.0';
const CORRECT_OTP = '1234';
const WRONG_OTP = '9999';
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe('POST /api/v1/auth/verify-otp', () => {
  const testData = createTestData('verify_otp');
  let app;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const post = (body) => request(app).post(URL).set('User-Agent', USER_AGENT).send(body);

  const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

  // Creates an OTP row directly (no email), with a known plain code.
  const createOtpFor = async (user, { code = CORRECT_OTP, expiresAt, ...columns } = {}) => {
    const otp = await createOtp(prisma, {
      userId: user.id,
      otpHash: await hashPassword(code),
      expiresAt: expiresAt ?? minutesFromNow(env.OTP_EXPIRY_MINUTES),
      ipAddress: '127.0.0.1',
    });
    if (Object.keys(columns).length === 0) return otp;
    return prisma.passwordResetOtp.update({ where: { id: otp.id }, data: columns });
  };

  const reload = (otp) => prisma.passwordResetOtp.findUnique({ where: { id: otp.id } });

  const auditRows = (user, action) =>
    prisma.auditLog.findMany({ where: { userId: user.id, action } });

  const expectErrorBody = (res, status, appError) => {
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, message: appError.message });
  };

  describe('correct OTP', () => {
    it('returns 200 with a reset token and the OTP expiry, and sets verifiedAt', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(Messages.PASSWORD_RESET_OTP_VERIFIED_SUCCESS);
      expect(res.body.data.resetToken).toMatch(BASE64URL_43);
      expect(res.body.data.expiresAt).toBe(otp.expiresAt.toISOString());
      expect(Object.keys(res.body.data).sort()).toEqual(['expiresAt', 'resetToken']);

      const row = await reload(otp);
      expect(row.verifiedAt).not.toBeNull();
      expect(row.attempts).toBe(0);
      expect(row.usedAt).toBeNull();
      expect(row.invalidatedAt).toBeNull();
    });

    it('stores only the SHA-256 hash of the token, never the token itself', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      const { resetToken } = res.body.data;
      const row = await reload(otp);
      expect(row.resetTokenHash).toMatch(SHA256_HEX);
      expect(row.resetTokenHash).toBe(hashToken(resetToken));
      expect(JSON.stringify(row)).not.toContain(resetToken);
    });

    it('writes an OTP_VERIFIED audit row without the OTP or the token', async () => {
      const user = await testData.createUser();
      await createOtpFor(user);

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      const rows = await auditRows(user, AuditAction.PASSWORD_RESET_OTP_VERIFIED);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ email: user.email, reason: null, userAgent: USER_AGENT });
      expect(rows[0].ipAddress).toBeTruthy();
      expect(Object.values(rows[0])).not.toContain(CORRECT_OTP);
      expect(JSON.stringify(rows[0])).not.toContain(res.body.data.resetToken);
    });

    it('rolls back verifiedAt and the token hash when the audit write fails', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);
      createAuditLog.mockRejectedValueOnce(new Error('audit write failed'));

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      expect(res.status).toBe(500);
      expect(res.body.data).toBeUndefined();
      const row = await reload(otp);
      expect(row.verifiedAt).toBeNull();
      expect(row.resetTokenHash).toBeNull();
      expect(await auditRows(user, AuditAction.PASSWORD_RESET_OTP_VERIFIED)).toHaveLength(0);
    });

    it('trims and lowercases the email and trims the OTP', async () => {
      const user = await testData.createUser();
      await createOtpFor(user);

      const res = await post({ email: `  ${user.email.toUpperCase()} `, otp: ` ${CORRECT_OTP} ` });

      expect(res.status).toBe(200);
    });

    it('rejects a second verify of the same OTP with OTP_ALREADY_USED', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);
      const first = await post({ email: user.email, otp: CORRECT_OTP });
      const hashAfterFirst = (await reload(otp)).resetTokenHash;

      const second = await post({ email: user.email, otp: CORRECT_OTP });

      expect(first.status).toBe(200);
      expectErrorBody(second, 400, AppErrors.OTP_ALREADY_USED);
      expect((await reload(otp)).resetTokenHash).toBe(hashAfterFirst);
    });
  });

  describe('wrong OTP', () => {
    it('returns 400 OTP_INVALID, increments attempts and audits OTP_FAILED without the OTP', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);

      const res = await post({ email: user.email, otp: WRONG_OTP });

      expectErrorBody(res, 400, AppErrors.OTP_INVALID);

      const row = await reload(otp);
      expect(row.attempts).toBe(1);
      expect(row.verifiedAt).toBeNull();
      expect(row.resetTokenHash).toBeNull();
      expect(row.invalidatedAt).toBeNull();

      const rows = await auditRows(user, AuditAction.PASSWORD_RESET_OTP_FAILED);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reason: AppErrors.OTP_INVALID.code, email: user.email });
      expect(Object.values(rows[0])).not.toContain(WRONG_OTP);
      expect(Object.values(rows[0])).not.toContain(CORRECT_OTP);
    });

    it('counts every wrong attempt', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);

      await post({ email: user.email, otp: WRONG_OTP });
      await post({ email: user.email, otp: '8888' });

      expect((await reload(otp)).attempts).toBe(2);
    });

    it('invalidates the OTP at the attempt limit and then rejects even the correct OTP', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user, { attempts: env.OTP_MAX_ATTEMPTS - 1 });

      const last = await post({ email: user.email, otp: WRONG_OTP });
      const afterwards = await post({ email: user.email, otp: CORRECT_OTP });

      expectErrorBody(last, 429, AppErrors.OTP_ATTEMPTS_EXCEEDED);
      expectErrorBody(afterwards, 429, AppErrors.OTP_ATTEMPTS_EXCEEDED);

      const row = await reload(otp);
      expect(row.attempts).toBe(env.OTP_MAX_ATTEMPTS);
      expect(row.invalidatedAt).not.toBeNull();
      expect(row.verifiedAt).toBeNull();

      const rows = await auditRows(user, AuditAction.PASSWORD_RESET_OTP_FAILED);
      expect(rows.map((r) => r.reason)).toEqual([AppErrors.OTP_ATTEMPTS_EXCEEDED.code]);
    });
  });

  describe('OTP state', () => {
    it('rejects an expired OTP with OTP_EXPIRED and does not count an attempt', async () => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user, { expiresAt: minutesFromNow(-1) });

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      expectErrorBody(res, 400, AppErrors.OTP_EXPIRED);
      const row = await reload(otp);
      expect(row.attempts).toBe(0);
      expect(row.verifiedAt).toBeNull();
    });

    it('rejects an OTP that was already used for a reset with OTP_ALREADY_USED', async () => {
      const user = await testData.createUser();
      await createOtpFor(user, { verifiedAt: new Date(), usedAt: new Date() });

      const res = await post({ email: user.email, otp: CORRECT_OTP });

      expectErrorBody(res, 400, AppErrors.OTP_ALREADY_USED);
    });

    it('rejects the old OTP after a newer one was requested, and the new one still works', async () => {
      const user = await testData.createUser();
      const oldOtp = await createOtpFor(user, { code: '1111' });
      await createOtpTx({
        userId: user.id,
        email: user.email,
        otpHash: await hashPassword('2222'),
        expiresAt: minutesFromNow(env.OTP_EXPIRY_MINUTES),
        now: new Date(),
      });

      const oldAttempt = await post({ email: user.email, otp: '1111' });
      const newAttempt = await post({ email: user.email, otp: '2222' });

      expectErrorBody(oldAttempt, 400, AppErrors.OTP_INVALID);
      expect(newAttempt.status).toBe(200);
      expect((await reload(oldOtp)).verifiedAt).toBeNull();
    });
  });

  describe('enumeration safety', () => {
    it('gives an unknown email exactly the same response as a wrong OTP', async () => {
      const user = await testData.createUser();
      await createOtpFor(user);

      const wrong = await post({ email: user.email, otp: WRONG_OTP });
      const unknown = await post({ email: testData.newEmail(), otp: WRONG_OTP });

      expect(unknown.status).toBe(wrong.status);
      expect(unknown.text).toBe(wrong.text);
    });

    it('gives a known user without any OTP the same response as a wrong OTP', async () => {
      const user = await testData.createUser();
      const other = await testData.createUser();
      await createOtpFor(other);

      const noOtp = await post({ email: user.email, otp: WRONG_OTP });
      const wrong = await post({ email: other.email, otp: WRONG_OTP });

      expect(noOtp.status).toBe(wrong.status);
      expect(noOtp.text).toBe(wrong.text);
    });

    it.each([AccountStatus.DISABLED, AccountStatus.PENDING])(
      'rejects a %s user with the same response as a wrong OTP, even with the correct OTP',
      async (status) => {
        const active = await testData.createUser();
        await createOtpFor(active);
        const user = await testData.createUser({ status });
        const otp = await createOtpFor(user);

        const wrong = await post({ email: active.email, otp: WRONG_OTP });
        const res = await post({ email: user.email, otp: CORRECT_OTP });

        expect(res.status).toBe(wrong.status);
        expect(res.text).toBe(wrong.text);
        const row = await reload(otp);
        expect(row.verifiedAt).toBeNull();
        expect(row.attempts).toBe(0);
      },
    );
  });

  describe('validation', () => {
    it.each([
      ['missing otp', (email) => ({ email })],
      ['otp with 5 digits', (email) => ({ email, otp: '12345' })],
      ['otp with letters', (email) => ({ email, otp: '12345a' })],
      ['numeric otp', (email) => ({ email, otp: 123456 })],
      ['missing email', () => ({ otp: CORRECT_OTP })],
      ['invalid email', () => ({ email: 'nope', otp: CORRECT_OTP })],
    ])('%s: 400 and nothing changes', async (_label, makeBody) => {
      const user = await testData.createUser();
      const otp = await createOtpFor(user);

      const res = await post(makeBody(user.email));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const row = await reload(otp);
      expect(row.attempts).toBe(0);
      expect(row.verifiedAt).toBeNull();
    });
  });
});
