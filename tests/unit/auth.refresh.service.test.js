jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/session.repository');

const { refreshTokens } = require('../../src/services/auth.service');
const userRepository = require('../../src/repositories/user.repository');
const sessionRepository = require('../../src/repositories/session.repository');
const env = require('../../src/config/env');
const { verifyAccessToken } = require('../../src/utils/jwt.util');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { AccountStatus } = require('../../src/constants/status');
const { AppErrors } = require('../../src/constants/errors');
const { Role } = require('../../src/constants/roles');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const META = { ipAddress: '203.0.113.9', userAgent: 'jest-agent/1.0' };
const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const SESSION_ID = 'session-id';

const buildSession = (overrides = {}) => ({
  id: SESSION_ID,
  userId: USER_ID,
  expiresAt: new Date(Date.now() + MS_PER_DAY),
  revokedAt: null,
  ...overrides,
});

const buildUser = (overrides = {}) => ({
  id: USER_ID,
  email: 'coach@test.invalid',
  role: Role.COACH,
  status: AccountStatus.ACTIVE,
  ...overrides,
});

const expectRejection = (promise, errorDef) =>
  expect(promise).rejects.toMatchObject({
    statusCode: errorDef.statusCode,
    code: errorDef.code,
  });

describe('auth.service - refreshTokens', () => {
  let presented;

  beforeEach(() => {
    presented = generateRefreshToken();
    sessionRepository.findByTokenHash.mockResolvedValue(buildSession());
    sessionRepository.rotate.mockResolvedValue({ sessionId: 'new-session-id' });
    sessionRepository.revokeAllByUser.mockResolvedValue(0);
    userRepository.findAuthWithEmailById.mockResolvedValue(buildUser());
  });

  describe('success', () => {
    it('looks the session up by the hash of the presented token, never the raw token', async () => {
      await refreshTokens(presented, META);

      expect(sessionRepository.findByTokenHash).toHaveBeenCalledWith(hashToken(presented));
    });

    it('returns a new access token with the DB role and a different refresh token', async () => {
      const tokens = await refreshTokens(presented, META);

      expect(verifyAccessToken(tokens.accessToken)).toMatchObject({
        sub: USER_ID,
        email: 'coach@test.invalid',
        role: Role.COACH,
      });
      expect(tokens.accessTokenExpiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);
      expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokens.refreshToken).not.toBe(presented);
      expect(Object.keys(tokens).sort()).toEqual([
        'accessToken',
        'accessTokenExpiresIn',
        'refreshToken',
        'refreshTokenExpiresAt',
      ]);
    });

    it('rotates the old session, storing only the hash of the new token and the request meta', async () => {
      const before = Date.now();
      const tokens = await refreshTokens(presented, META);

      const [oldId, newSession, now] = sessionRepository.rotate.mock.calls[0];
      expect(oldId).toBe(SESSION_ID);
      expect(newSession).toEqual({
        userId: USER_ID,
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshTokenExpiresAt,
        meta: META,
      });
      expect(JSON.stringify(sessionRepository.rotate.mock.calls)).not.toContain(
        tokens.refreshToken,
      );
      expect(tokens.refreshTokenExpiresAt.getTime() - now.getTime()).toBe(
        env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY,
      );
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('uses the role stored in the DB for the new access token', async () => {
      userRepository.findAuthWithEmailById.mockResolvedValue(buildUser({ role: Role.ADMIN }));

      const tokens = await refreshTokens(presented, META);

      expect(verifyAccessToken(tokens.accessToken).role).toBe(Role.ADMIN);
    });

    it('does not revoke other sessions', async () => {
      await refreshTokens(presented, META);

      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
    });
  });

  describe('rejections', () => {
    it('unknown token -> 401 INVALID_TOKEN, nothing revoked or rotated', async () => {
      sessionRepository.findByTokenHash.mockResolvedValue(null);

      await expectRejection(refreshTokens(presented, META), AppErrors.INVALID_TOKEN);
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
    });

    it('revoked token (reuse) -> revokes every session of the user, 401 INVALID_TOKEN', async () => {
      sessionRepository.findByTokenHash.mockResolvedValue(
        buildSession({ revokedAt: new Date('2026-01-01T00:00:00Z') }),
      );

      await expectRejection(refreshTokens(presented, META), AppErrors.INVALID_TOKEN);
      expect(sessionRepository.revokeAllByUser).toHaveBeenCalledWith(USER_ID);
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
      expect(userRepository.findAuthWithEmailById).not.toHaveBeenCalled();
    });

    it('revoked AND expired token is still treated as reuse', async () => {
      sessionRepository.findByTokenHash.mockResolvedValue(
        buildSession({ revokedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date(0) }),
      );

      await expectRejection(refreshTokens(presented, META), AppErrors.INVALID_TOKEN);
      expect(sessionRepository.revokeAllByUser).toHaveBeenCalledWith(USER_ID);
    });

    it('expired token -> 401 TOKEN_EXPIRED, nothing revoked or rotated', async () => {
      sessionRepository.findByTokenHash.mockResolvedValue(
        buildSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expectRejection(refreshTokens(presented, META), AppErrors.TOKEN_EXPIRED);
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
    });

    it('user no longer exists -> 401 INVALID_TOKEN, nothing rotated', async () => {
      userRepository.findAuthWithEmailById.mockResolvedValue(null);

      await expectRejection(refreshTokens(presented, META), AppErrors.INVALID_TOKEN);
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
    });

    it.each([
      [AccountStatus.DISABLED, AppErrors.ACCOUNT_DISABLED],
      [AccountStatus.PENDING, AppErrors.REGISTRATION_INCOMPLETE],
      ['SUSPENDED', AppErrors.ACCOUNT_DISABLED],
    ])('%s account -> 403, nothing rotated', async (status, errorDef) => {
      userRepository.findAuthWithEmailById.mockResolvedValue(buildUser({ status }));

      await expectRejection(refreshTokens(presented, META), errorDef);
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
    });

    it('lost the race (rotate returns null) -> plain 401 INVALID_TOKEN, no revoke-all', async () => {
      sessionRepository.rotate.mockResolvedValue(null);

      await expectRejection(refreshTokens(presented, META), AppErrors.INVALID_TOKEN);
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
    });
  });

  describe('infrastructure errors', () => {
    it('propagates a rotate failure unchanged (no tokens returned)', async () => {
      const dbError = new Error('db down');
      sessionRepository.rotate.mockRejectedValue(dbError);

      await expect(refreshTokens(presented, META)).rejects.toBe(dbError);
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
    });

    it('propagates a revokeAllByUser failure instead of a 401', async () => {
      const dbError = new Error('db down');
      sessionRepository.findByTokenHash.mockResolvedValue(
        buildSession({ revokedAt: new Date('2026-01-01T00:00:00Z') }),
      );
      sessionRepository.revokeAllByUser.mockRejectedValue(dbError);

      await expect(refreshTokens(presented, META)).rejects.toBe(dbError);
    });
  });
});
