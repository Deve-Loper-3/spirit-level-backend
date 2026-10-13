const request = require('supertest');

// No real emails: every SMTP send goes to this mock.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { comparePassword } = require('../../src/utils/password.util');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction, PasswordResetSkipReason } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(30000);

const URL = '/api/v1/auth/forgot-password';
const USER_AGENT = 'jest-forgot-password-test/1.0';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;
const OTP_IN_EMAIL = /reset code is: (\d{4})/;

describe('POST /api/v1/auth/forgot-password', () => {
  const testData = createTestData('forgot_password');
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const post = (body) => request(app).post(URL).set('User-Agent', USER_AGENT).send(body);

  // The email is sent in the background, so wait until the mock has been called.
  const waitForEmail = async () => {
    for (let i = 0; i < 50 && mockSendMail.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    return mockSendMail.mock.calls[0][0];
  };

  const otpsOf = (userId) =>
    prisma.passwordResetOtp.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  const expectGenericSuccess = (res) => {
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: Messages.PASSWORD_RESET_OTP_REQUESTED,
      data: null,
    });
  };

  describe('ACTIVE user', () => {
    it('returns the generic 200, stores a hashed OTP with expiry and emails the plain OTP', async () => {
      const user = await testData.createUser();
      const before = Date.now();

      const res = await post({ email: user.email });

      expectGenericSuccess(res);

      const [otp] = await otpsOf(user.id);
      const mail = await waitForEmail();
      const plainOtp = mail.text.match(OTP_IN_EMAIL)[1];

      expect(mail.to).toBe(user.email);
      expect(mail.html).toContain(plainOtp);
      expect(mail.subject).not.toContain(plainOtp);

      expect(otp.otpHash).toMatch(BCRYPT_HASH_PATTERN);
      await expect(comparePassword(plainOtp, otp.otpHash)).resolves.toBe(true);
      expect(otp.attempts).toBe(0);
      expect(otp.verifiedAt).toBeNull();
      expect(otp.usedAt).toBeNull();
      expect(otp.invalidatedAt).toBeNull();
      expect(otp.resetTokenHash).toBeNull();
      expect(otp.ipAddress).toBeTruthy();

      const expectedExpiry = before + env.OTP_EXPIRY_MINUTES * 60 * 1000;
      expect(Math.abs(otp.expiresAt.getTime() - expectedExpiry)).toBeLessThan(60 * 1000);
    });

    it('never stores the OTP as plain text', async () => {
      const user = await testData.createUser();

      await post({ email: user.email });

      const [otp] = await otpsOf(user.id);
      const plainOtp = (await waitForEmail()).text.match(OTP_IN_EMAIL)[1];

      expect(Object.values(otp)).not.toContain(plainOtp);
      expect(otp.otpHash).not.toBe(plainOtp);
    });

    it('writes a PASSWORD_RESET_REQUESTED audit row with the user, email, ip and user agent', async () => {
      const user = await testData.createUser();

      await post({ email: user.email });
      await waitForEmail();

      const rows = await prisma.auditLog.findMany({ where: { userId: user.id } });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        email: user.email,
        reason: null,
        userAgent: USER_AGENT,
      });
      expect(rows[0].ipAddress).toBeTruthy();
    });

    it('trims and lowercases the email', async () => {
      const user = await testData.createUser();

      const res = await post({ email: `  ${user.email.toUpperCase()}  ` });

      expectGenericSuccess(res);
      expect(await otpsOf(user.id)).toHaveLength(1);
      await waitForEmail();
    });

    it('invalidates the previous OTP when a new one is requested', async () => {
      const user = await testData.createUser();

      await post({ email: user.email });
      await waitForEmail();
      mockSendMail.mockClear();
      await post({ email: user.email });
      await waitForEmail();

      const [first, second] = await otpsOf(user.id);

      expect(first.invalidatedAt).not.toBeNull();
      expect(second.invalidatedAt).toBeNull();
      expect(second.otpHash).not.toBe(first.otpHash);
    });

    it('still returns the same 200 and keeps the OTP when the email cannot be sent', async () => {
      const user = await testData.createUser();
      mockSendMail.mockRejectedValue(new Error('SMTP connection timed out'));

      const res = await post({ email: user.email });

      expectGenericSuccess(res);
      await waitForEmail();
      expect(await otpsOf(user.id)).toHaveLength(1);
    });
  });

  describe('unknown, PENDING or DISABLED user', () => {
    const expectNoOtpNoEmail = async (userId) => {
      // Give a (wrongly) sent background email time to show up before asserting none was sent.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(mockSendMail).not.toHaveBeenCalled();
      if (userId) {
        expect(await otpsOf(userId)).toHaveLength(0);
      }
    };

    const findSkipAudit = (email) =>
      prisma.auditLog.findMany({
        where: { email, action: AuditAction.PASSWORD_RESET_REQUESTED },
      });

    it('unknown email: generic 200, audit row with null userId and reason, no email', async () => {
      const email = testData.newEmail();

      const res = await post({ email });

      expectGenericSuccess(res);
      await expectNoOtpNoEmail();

      const rows = await findSkipAudit(email);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: null,
        reason: PasswordResetSkipReason.UNKNOWN_EMAIL,
        userAgent: USER_AGENT,
      });
    });

    it.each([
      [AccountStatus.PENDING, PasswordResetSkipReason.ACCOUNT_PENDING],
      [AccountStatus.DISABLED, PasswordResetSkipReason.ACCOUNT_DISABLED],
    ])(
      '%s user: generic 200, audit row with reason %s, no OTP, no email',
      async (status, reason) => {
        const user = await testData.createUser({ status });

        const res = await post({ email: user.email });

        expectGenericSuccess(res);
        await expectNoOtpNoEmail(user.id);

        const rows = await findSkipAudit(user.email);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ userId: null, reason });
      },
    );
  });

  describe('enumeration safety', () => {
    it('gives byte-identical bodies and the same status for known and unknown emails', async () => {
      const user = await testData.createUser();

      const known = await post({ email: user.email });
      await waitForEmail();
      const unknown = await post({ email: testData.newEmail() });

      expect(known.status).toBe(unknown.status);
      expect(known.text).toBe(unknown.text);
      expect(Object.keys(known.body)).toEqual(Object.keys(unknown.body));
    });
  });

  describe('validation', () => {
    it.each([
      ['missing email', {}],
      ['invalid email', { email: 'not-an-email' }],
      ['non-string email', { email: 123 }],
    ])('%s: 400, no OTP, no email', async (_label, body) => {
      const res = await post(body);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });
});
