jest.mock('../../src/config/prisma', () => ({ mockPrisma: true }));
jest.mock('../../src/config/logger', () => ({ error: jest.fn() }));
jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/audit-log.repository');
jest.mock('../../src/repositories/password-reset.repository');
jest.mock('../../src/utils/password.util');
jest.mock('../../src/utils/otp.util');
jest.mock('../../src/utils/token.util');
jest.mock('../../src/infra/mail/notify.service');

const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const logger = require('../../src/config/logger');
const { findByEmail } = require('../../src/repositories/user.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const {
  createOtpTx,
  findLatestByEmail,
  incrementAttempts,
  invalidateOtp,
  markVerifiedTx,
  resetPasswordTx,
} = require('../../src/repositories/password-reset.repository');
const { hashPassword, comparePassword } = require('../../src/utils/password.util');
const { generateOtp } = require('../../src/utils/otp.util');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { sendPasswordResetOtp } = require('../../src/infra/mail/notify.service');
const { AuditAction, PasswordResetSkipReason } = require('../../src/constants/audit');
const { AppErrors } = require('../../src/constants/errors');
const { AccountStatus } = require('../../src/constants/status');
const { Messages } = require('../../src/constants/messages');
const {
  requestPasswordReset,
  verifyResetOtp,
  resetPassword,
} = require('../../src/services/password-reset.service');

const NOW = new Date('2026-10-11T10:00:00.000Z');
const OTP = '004217';
const meta = { ipAddress: '1.2.3.4', userAgent: 'jest' };
const email = 'jane@example.com';

const makeUser = (overrides = {}) => ({
  id: 'user-1',
  email,
  fullName: 'Jane Doe',
  status: AccountStatus.ACTIVE,
  ...overrides,
});

describe('password-reset.service › requestPasswordReset', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    generateOtp.mockReturnValue(OTP);
    hashPassword.mockResolvedValue('hashed-otp');
    createOtpTx.mockResolvedValue({ otpId: 'otp-1' });
    createAuditLog.mockResolvedValue({});
    sendPasswordResetOtp.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('unknown, PENDING or DISABLED user', () => {
    it.each([
      ['unknown email', null, PasswordResetSkipReason.UNKNOWN_EMAIL],
      [
        'PENDING user',
        makeUser({ status: AccountStatus.PENDING }),
        PasswordResetSkipReason.ACCOUNT_PENDING,
      ],
      [
        'DISABLED user',
        makeUser({ status: AccountStatus.DISABLED }),
        PasswordResetSkipReason.ACCOUNT_DISABLED,
      ],
    ])(
      '%s: audits with a reason (userId null) and creates no OTP and sends no email',
      async (_label, user, reason) => {
        findByEmail.mockResolvedValue(user);

        await expect(requestPasswordReset({ email, meta })).resolves.toBeUndefined();

        expect(createAuditLog).toHaveBeenCalledTimes(1);
        expect(createAuditLog).toHaveBeenCalledWith(prisma, {
          action: AuditAction.PASSWORD_RESET_REQUESTED,
          reason,
          email,
          meta,
        });
        expect(generateOtp).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
        expect(createOtpTx).not.toHaveBeenCalled();
        expect(sendPasswordResetOtp).not.toHaveBeenCalled();
      },
    );

    it('denies any other status by default', async () => {
      findByEmail.mockResolvedValue(makeUser({ status: 'SUSPENDED' }));

      await requestPasswordReset({ email, meta });

      expect(createAuditLog).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ reason: PasswordResetSkipReason.ACCOUNT_DISABLED }),
      );
      expect(createOtpTx).not.toHaveBeenCalled();
    });
  });

  describe('ACTIVE user', () => {
    beforeEach(() => {
      findByEmail.mockResolvedValue(makeUser());
    });

    it('looks the user up by the given (already normalized) email', async () => {
      await requestPasswordReset({ email, meta });

      expect(findByEmail).toHaveBeenCalledWith(email);
    });

    it('stores the bcrypt HASH of the OTP with the configured expiry, in one createOtpTx call', async () => {
      await requestPasswordReset({ email, meta });

      expect(hashPassword).toHaveBeenCalledWith(OTP);
      expect(createOtpTx).toHaveBeenCalledTimes(1);
      expect(createOtpTx).toHaveBeenCalledWith({
        userId: 'user-1',
        email,
        otpHash: 'hashed-otp',
        expiresAt: new Date(NOW.getTime() + env.OTP_EXPIRY_MINUTES * 60 * 1000),
        now: NOW,
        meta,
      });
      expect(JSON.stringify(createOtpTx.mock.calls)).not.toContain(OTP);
    });

    it('does not write the skip audit row (createOtpTx writes its own)', async () => {
      await requestPasswordReset({ email, meta });

      expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('sends the plain OTP by email after the OTP is committed', async () => {
      await requestPasswordReset({ email, meta });

      expect(sendPasswordResetOtp).toHaveBeenCalledWith({ email, fullName: 'Jane Doe' }, OTP);
      expect(createOtpTx.mock.invocationCallOrder[0]).toBeLessThan(
        sendPasswordResetOtp.mock.invocationCallOrder[0],
      );
    });

    it('does not wait for the email: resolves while the send is still pending', async () => {
      sendPasswordResetOtp.mockReturnValue(new Promise(() => {}));

      await expect(requestPasswordReset({ email, meta })).resolves.toBeUndefined();
    });

    it('swallows an email failure and logs it without the OTP, address or error message', async () => {
      const smtpError = Object.assign(new Error(`failed to send ${OTP} to ${email}`), {
        code: 'ECONNECTION',
      });
      sendPasswordResetOtp.mockRejectedValue(smtpError);

      await expect(requestPasswordReset({ email, meta })).resolves.toBeUndefined();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        { userId: 'user-1', errorName: 'Error', errorCode: 'ECONNECTION' },
        Messages.PASSWORD_RESET_EMAIL_FAILED,
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(OTP);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(email);
    });

    it('propagates a createOtpTx failure and sends no email', async () => {
      createOtpTx.mockRejectedValue(new Error('db down'));

      await expect(requestPasswordReset({ email, meta })).rejects.toThrow('db down');
      expect(sendPasswordResetOtp).not.toHaveBeenCalled();
    });
  });

  it('resolves with the same value (undefined) for known and unknown emails', async () => {
    findByEmail.mockResolvedValueOnce(makeUser()).mockResolvedValueOnce(null);

    const known = await requestPasswordReset({ email, meta });
    const unknown = await requestPasswordReset({ email: 'nobody@example.com', meta });

    expect(known).toBe(unknown);
  });
});

describe('password-reset.service › verifyResetOtp', () => {
  const RESET_TOKEN = 'plain-reset-token';
  const expiresAt = new Date(NOW.getTime() + 5 * 60 * 1000);

  const makeRow = (overrides = {}, userOverrides = {}) => ({
    id: 'otp-1',
    otpHash: 'hashed-otp',
    attempts: 0,
    expiresAt,
    verifiedAt: null,
    usedAt: null,
    invalidatedAt: null,
    user: makeUser(userOverrides),
    ...overrides,
  });

  const expectAppError = (promise, appError) =>
    expect(promise).rejects.toMatchObject({
      statusCode: appError.statusCode,
      code: appError.code,
    });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    findLatestByEmail.mockResolvedValue(makeRow());
    comparePassword.mockResolvedValue(true);
    incrementAttempts.mockResolvedValue({ attempts: 1 });
    generateRefreshToken.mockReturnValue(RESET_TOKEN);
    hashToken.mockReturnValue('hashed-token');
    createAuditLog.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('correct OTP', () => {
    it('stores only the token hash via markVerifiedTx and returns the token with the OTP expiry', async () => {
      const result = await verifyResetOtp({ email, otp: OTP, meta });

      expect(findLatestByEmail).toHaveBeenCalledWith(email);
      expect(comparePassword).toHaveBeenCalledWith(OTP, 'hashed-otp');
      expect(hashToken).toHaveBeenCalledWith(RESET_TOKEN);
      expect(markVerifiedTx).toHaveBeenCalledWith({
        otpId: 'otp-1',
        userId: 'user-1',
        email,
        resetTokenHash: 'hashed-token',
        now: NOW,
        meta,
      });
      expect(createAuditLog).not.toHaveBeenCalled();
      expect(result).toEqual({ resetToken: RESET_TOKEN, expiresAt });
      expect(incrementAttempts).not.toHaveBeenCalled();
    });

    it('never passes the OTP or the plain token to markVerifiedTx', async () => {
      await verifyResetOtp({ email, otp: OTP, meta });

      const stored = JSON.stringify(markVerifiedTx.mock.calls);
      expect(stored).not.toContain(OTP);
      expect(stored).not.toContain(RESET_TOKEN);
    });
  });

  describe('wrong OTP', () => {
    beforeEach(() => {
      comparePassword.mockResolvedValue(false);
    });

    it('counts the attempt, audits OTP_FAILED without the OTP and throws OTP_INVALID', async () => {
      await expectAppError(verifyResetOtp({ email, otp: '999999', meta }), AppErrors.OTP_INVALID);

      expect(incrementAttempts).toHaveBeenCalledWith('otp-1');
      expect(invalidateOtp).not.toHaveBeenCalled();
      expect(markVerifiedTx).not.toHaveBeenCalled();
      expect(createAuditLog).toHaveBeenCalledWith(prisma, {
        userId: 'user-1',
        action: AuditAction.PASSWORD_RESET_OTP_FAILED,
        reason: AppErrors.OTP_INVALID.code,
        email,
        meta,
      });
      expect(JSON.stringify(createAuditLog.mock.calls)).not.toContain('999999');
    });

    it('invalidates the OTP and throws OTP_ATTEMPTS_EXCEEDED when this attempt reaches the limit', async () => {
      incrementAttempts.mockResolvedValue({ attempts: env.OTP_MAX_ATTEMPTS });

      await expectAppError(
        verifyResetOtp({ email, otp: '999999', meta }),
        AppErrors.OTP_ATTEMPTS_EXCEEDED,
      );

      expect(invalidateOtp).toHaveBeenCalledWith('otp-1', NOW);
      expect(createAuditLog).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          action: AuditAction.PASSWORD_RESET_OTP_FAILED,
          reason: AppErrors.OTP_ATTEMPTS_EXCEEDED.code,
        }),
      );
    });

    it('does not invalidate one attempt before the limit', async () => {
      incrementAttempts.mockResolvedValue({ attempts: env.OTP_MAX_ATTEMPTS - 1 });

      await expectAppError(verifyResetOtp({ email, otp: '999999', meta }), AppErrors.OTP_INVALID);

      expect(invalidateOtp).not.toHaveBeenCalled();
    });
  });

  describe('guards run before any bcrypt compare or write', () => {
    it.each([
      ['no OTP row (unknown email)', null, AppErrors.OTP_INVALID],
      ['DISABLED user', makeRow({}, { status: AccountStatus.DISABLED }), AppErrors.OTP_INVALID],
      ['PENDING user', makeRow({}, { status: AccountStatus.PENDING }), AppErrors.OTP_INVALID],
      ['used OTP', makeRow({ usedAt: NOW }), AppErrors.OTP_ALREADY_USED],
      ['already verified OTP', makeRow({ verifiedAt: NOW }), AppErrors.OTP_ALREADY_USED],
      [
        'OTP at the attempt limit',
        makeRow({ attempts: env.OTP_MAX_ATTEMPTS }),
        AppErrors.OTP_ATTEMPTS_EXCEEDED,
      ],
      ['invalidated OTP', makeRow({ invalidatedAt: NOW }), AppErrors.OTP_INVALID],
      [
        'expired OTP',
        makeRow({ expiresAt: new Date(NOW.getTime() - 1000) }),
        AppErrors.OTP_EXPIRED,
      ],
    ])('%s', async (_label, row, appError) => {
      findLatestByEmail.mockResolvedValue(row);

      await expectAppError(verifyResetOtp({ email, otp: OTP, meta }), appError);

      expect(comparePassword).not.toHaveBeenCalled();
      expect(incrementAttempts).not.toHaveBeenCalled();
      expect(markVerifiedTx).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('treats a DISABLED user exactly like an unknown email', async () => {
      findLatestByEmail.mockResolvedValueOnce(null);
      const unknown = await verifyResetOtp({ email, otp: OTP, meta }).catch((err) => err);
      findLatestByEmail.mockResolvedValueOnce(makeRow({}, { status: AccountStatus.DISABLED }));
      const disabled = await verifyResetOtp({ email, otp: OTP, meta }).catch((err) => err);

      expect(disabled.statusCode).toBe(unknown.statusCode);
      expect(disabled.message).toBe(unknown.message);
      expect(disabled.code).toBe(unknown.code);
    });
  });

  it('propagates a markVerifiedTx failure and returns no token', async () => {
    markVerifiedTx.mockRejectedValue(new Error('db down'));

    await expect(verifyResetOtp({ email, otp: OTP, meta })).rejects.toThrow('db down');
  });
});

describe('password-reset.service › resetPassword', () => {
  const RESET_TOKEN = 'plain-reset-token';
  const NEW_PASSWORD = 'NewPassw0rd';
  const expiresAt = new Date(NOW.getTime() + 5 * 60 * 1000);
  const input = { email, resetToken: RESET_TOKEN, newPassword: NEW_PASSWORD, meta };

  const makeRow = (overrides = {}, userOverrides = {}) => ({
    id: 'otp-1',
    expiresAt,
    attempts: 0,
    verifiedAt: new Date(NOW.getTime() - 1000),
    usedAt: null,
    invalidatedAt: null,
    resetTokenHash: 'hashed-token',
    user: makeUser(userOverrides),
    ...overrides,
  });

  const expectAppError = (promise, appError) =>
    expect(promise).rejects.toMatchObject({
      statusCode: appError.statusCode,
      code: appError.code,
    });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    findLatestByEmail.mockResolvedValue(makeRow());
    hashToken.mockReturnValue('hashed-token');
    hashPassword.mockResolvedValue('hashed-new-password');
    resetPasswordTx.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hashes the new password and resets everything in one resetPasswordTx call', async () => {
    await expect(resetPassword(input)).resolves.toBeUndefined();

    expect(findLatestByEmail).toHaveBeenCalledWith(email);
    expect(hashToken).toHaveBeenCalledWith(RESET_TOKEN);
    expect(hashPassword).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(resetPasswordTx).toHaveBeenCalledTimes(1);
    expect(resetPasswordTx).toHaveBeenCalledWith({
      otpId: 'otp-1',
      userId: 'user-1',
      email,
      passwordHash: 'hashed-new-password',
      now: NOW,
      meta,
    });
  });

  it('never passes the plain password or the plain token to resetPasswordTx', async () => {
    await resetPassword(input);

    const stored = JSON.stringify(resetPasswordTx.mock.calls);
    expect(stored).not.toContain(NEW_PASSWORD);
    expect(stored).not.toContain(RESET_TOKEN);
  });

  describe('guards run before hashing the password or writing anything', () => {
    it.each([
      ['no OTP row (unknown email)', null, AppErrors.OTP_INVALID],
      ['DISABLED user', makeRow({}, { status: AccountStatus.DISABLED }), AppErrors.OTP_INVALID],
      ['PENDING user', makeRow({}, { status: AccountStatus.PENDING }), AppErrors.OTP_INVALID],
      ['used OTP', makeRow({ usedAt: NOW }), AppErrors.OTP_ALREADY_USED],
      ['OTP that was never verified', makeRow({ verifiedAt: null }), AppErrors.OTP_INVALID],
      ['invalidated OTP', makeRow({ invalidatedAt: NOW }), AppErrors.OTP_INVALID],
      [
        'expired OTP',
        makeRow({ expiresAt: new Date(NOW.getTime() - 1000) }),
        AppErrors.OTP_EXPIRED,
      ],
      ['wrong reset token', makeRow({ resetTokenHash: 'other-hash' }), AppErrors.OTP_INVALID],
    ])('%s', async (_label, row, appError) => {
      findLatestByEmail.mockResolvedValue(row);

      await expectAppError(resetPassword(input), appError);

      expect(hashPassword).not.toHaveBeenCalled();
      expect(resetPasswordTx).not.toHaveBeenCalled();
    });
  });

  it('propagates a resetPasswordTx failure', async () => {
    resetPasswordTx.mockRejectedValue(new Error('db down'));

    await expect(resetPassword(input)).rejects.toThrow('db down');
  });
});
