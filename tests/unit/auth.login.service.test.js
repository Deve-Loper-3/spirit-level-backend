jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/session.repository');
jest.mock('../../src/repositories/audit-log.repository');
jest.mock('../../src/utils/password.util');
jest.mock('../../src/config/logger', () => ({ error: jest.fn() }));

const { loginWithPassword } = require('../../src/services/auth.service');
const userRepository = require('../../src/repositories/user.repository');
const sessionRepository = require('../../src/repositories/session.repository');
const auditLogRepository = require('../../src/repositories/audit-log.repository');
const passwordUtil = require('../../src/utils/password.util');
const logger = require('../../src/config/logger');
const env = require('../../src/config/env');
const { verifyAccessToken } = require('../../src/utils/jwt.util');
const { hashToken } = require('../../src/utils/token.util');
const { AccountStatus } = require('../../src/constants/status');
const { AppErrors } = require('../../src/constants/errors');
const { LoginFailureReason } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { Role } = require('../../src/constants/roles');
const { Gender } = require('../../src/constants/gender');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DUMMY_HASH = 'dummy-hash';
const STORED_HASH = 'stored-password-hash';
const INPUT = { email: 'member@test.invalid', password: 'Password123' };
const META = { ipAddress: '203.0.113.9', userAgent: 'jest-agent/1.0' };

const buildUser = (overrides = {}) => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  fullName: 'Jane Doe',
  email: INPUT.email,
  phone: '+12025550100',
  whatsappNumber: null,
  gender: Gender.FEMALE,
  birthDay: null,
  birthMonth: null,
  role: Role.MEMBER,
  status: AccountStatus.ACTIVE,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  passwordHash: STORED_HASH,
  ...overrides,
});

describe('auth.service - loginWithPassword', () => {
  beforeEach(() => {
    passwordUtil.hashPassword.mockResolvedValue(DUMMY_HASH);
    passwordUtil.comparePassword.mockResolvedValue(true);
    auditLogRepository.recordLoginFailure.mockResolvedValue(undefined);
    sessionRepository.createLoginSessionTx.mockResolvedValue({ sessionId: 'session-id' });
  });

  describe('successful login', () => {
    it('returns the public user and tokens, without passwordHash', async () => {
      const user = buildUser();
      userRepository.findForLogin.mockResolvedValue(user);

      const result = await loginWithPassword(INPUT, META);

      expect(userRepository.findForLogin).toHaveBeenCalledWith(INPUT.email);
      expect(passwordUtil.comparePassword).toHaveBeenCalledWith(INPUT.password, STORED_HASH);
      expect(result.user).toMatchObject({ id: user.id, email: user.email, role: user.role });
      expect(result.user.passwordHash).toBeUndefined();
      expect(verifyAccessToken(result.tokens.accessToken)).toMatchObject({
        sub: user.id,
        role: user.role,
      });
      expect(result.tokens.accessTokenExpiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);
      expect(auditLogRepository.recordLoginFailure).not.toHaveBeenCalled();
    });

    it('stores only the hash of the refresh token, expiring after REFRESH_TOKEN_TTL_DAYS', async () => {
      userRepository.findForLogin.mockResolvedValue(buildUser());

      const { tokens } = await loginWithPassword(INPUT, META);

      const [session] = sessionRepository.createLoginSessionTx.mock.calls[0];
      expect(session.tokenHash).toBe(hashToken(tokens.refreshToken));
      expect(session.tokenHash).not.toBe(tokens.refreshToken);
      expect(session.expiresAt.getTime() - session.now.getTime()).toBe(
        env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY,
      );
      expect(tokens.refreshTokenExpiresAt).toEqual(session.expiresAt);
      expect(session).toMatchObject({ userId: buildUser().id, meta: META });
    });
  });

  describe('invalid credentials', () => {
    it('rejects a wrong password with INVALID_CREDENTIALS and records the failure', async () => {
      const user = buildUser();
      userRepository.findForLogin.mockResolvedValue(user);
      passwordUtil.comparePassword.mockResolvedValue(false);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 401,
        message: AppErrors.INVALID_CREDENTIALS.message,
        code: AppErrors.INVALID_CREDENTIALS.code,
      });

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith({
        userId: user.id,
        email: INPUT.email,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
        meta: META,
      });
      expect(sessionRepository.createLoginSessionTx).not.toHaveBeenCalled();
    });

    it('compares against the dummy hash for an unknown email and rejects with the same 401', async () => {
      userRepository.findForLogin.mockResolvedValue(null);
      passwordUtil.comparePassword.mockResolvedValue(false);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 401,
        message: AppErrors.INVALID_CREDENTIALS.message,
        code: AppErrors.INVALID_CREDENTIALS.code,
      });

      expect(passwordUtil.comparePassword).toHaveBeenCalledTimes(1);
      expect(passwordUtil.comparePassword).toHaveBeenCalledWith(INPUT.password, DUMMY_HASH);
      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith({
        userId: undefined,
        email: INPUT.email,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
        meta: META,
      });
    });

    it('never logs in an unknown email, even if the dummy comparison reports a match', async () => {
      userRepository.findForLogin.mockResolvedValue(null);
      passwordUtil.comparePassword.mockResolvedValue(true);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({ statusCode: 401 });

      expect(sessionRepository.createLoginSessionTx).not.toHaveBeenCalled();
    });

    it('creates the dummy hash lazily and only once', async () => {
      userRepository.findForLogin.mockResolvedValue(null);
      passwordUtil.comparePassword.mockResolvedValue(false);

      await expect(loginWithPassword(INPUT, META)).rejects.toThrow();
      await expect(loginWithPassword(INPUT, META)).rejects.toThrow();

      expect(passwordUtil.hashPassword.mock.calls.length).toBeLessThanOrEqual(1);
      const hashesUsed = passwordUtil.comparePassword.mock.calls.map(([, hash]) => hash);
      expect(hashesUsed).toEqual([DUMMY_HASH, DUMMY_HASH]);
    });

    it('does not create a dummy hash when the user exists', async () => {
      userRepository.findForLogin.mockResolvedValue(buildUser());
      passwordUtil.hashPassword.mockClear();

      await loginWithPassword(INPUT, META);

      expect(passwordUtil.hashPassword).not.toHaveBeenCalled();
    });
  });

  describe('account status (checked only after the password)', () => {
    it('answers a wrong password on a PENDING account with 401, not the status error', async () => {
      userRepository.findForLogin.mockResolvedValue(buildUser({ status: AccountStatus.PENDING }));
      passwordUtil.comparePassword.mockResolvedValue(false);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 401,
        code: AppErrors.INVALID_CREDENTIALS.code,
      });

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: LoginFailureReason.INVALID_CREDENTIALS }),
      );
    });

    it('rejects PENDING with REGISTRATION_INCOMPLETE (403) and records ACCOUNT_PENDING', async () => {
      const user = buildUser({ status: AccountStatus.PENDING });
      userRepository.findForLogin.mockResolvedValue(user);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 403,
        code: AppErrors.REGISTRATION_INCOMPLETE.code,
      });

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith({
        userId: user.id,
        email: INPUT.email,
        reason: LoginFailureReason.ACCOUNT_PENDING,
        meta: META,
      });
      expect(sessionRepository.createLoginSessionTx).not.toHaveBeenCalled();
    });

    it('rejects DISABLED with ACCOUNT_DISABLED (403) and records ACCOUNT_DISABLED', async () => {
      const user = buildUser({ status: AccountStatus.DISABLED });
      userRepository.findForLogin.mockResolvedValue(user);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 403,
        code: AppErrors.ACCOUNT_DISABLED.code,
      });

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith({
        userId: user.id,
        email: INPUT.email,
        reason: LoginFailureReason.ACCOUNT_DISABLED,
        meta: META,
      });
      expect(sessionRepository.createLoginSessionTx).not.toHaveBeenCalled();
    });
  });

  describe('audit write failure', () => {
    const auditError = Object.assign(new Error(`insert failed for ${INPUT.password}`), {
      code: 'P1001',
    });

    it('still answers 401 and logs without secrets when the failure cannot be recorded', async () => {
      userRepository.findForLogin.mockResolvedValue(buildUser());
      passwordUtil.comparePassword.mockResolvedValue(false);
      auditLogRepository.recordLoginFailure.mockRejectedValue(auditError);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 401,
        code: AppErrors.INVALID_CREDENTIALS.code,
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: LoginFailureReason.INVALID_CREDENTIALS,
          errorCode: 'P1001',
        }),
        Messages.LOGIN_AUDIT_WRITE_FAILED,
      );
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain(INPUT.password);
      expect(logged).not.toContain(STORED_HASH);
    });

    it('still answers 403 when the status failure cannot be recorded', async () => {
      userRepository.findForLogin.mockResolvedValue(buildUser({ status: AccountStatus.DISABLED }));
      auditLogRepository.recordLoginFailure.mockRejectedValue(auditError);

      await expect(loginWithPassword(INPUT, META)).rejects.toMatchObject({
        statusCode: 403,
        code: AppErrors.ACCOUNT_DISABLED.code,
      });

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  it('propagates a session transaction failure without returning tokens', async () => {
    userRepository.findForLogin.mockResolvedValue(buildUser());
    const dbError = new Error('transaction failed');
    sessionRepository.createLoginSessionTx.mockRejectedValue(dbError);

    await expect(loginWithPassword(INPUT, META)).rejects.toBe(dbError);
  });
});
