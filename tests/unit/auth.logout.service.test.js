jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/session.repository');

const { logout } = require('../../src/services/auth.service');
const sessionRepository = require('../../src/repositories/session.repository');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');

const USER = { id: 'user-id', role: 'MEMBER', status: 'ACTIVE' };
const META = { ipAddress: '203.0.113.9', userAgent: 'jest-agent/1.0' };

describe('auth.service - logout', () => {
  let presented;

  beforeEach(() => {
    presented = generateRefreshToken();
    sessionRepository.revokeSessionWithLogoutAuditTx.mockResolvedValue(true);
  });

  it('revokes by the hash of the token, scoped to the authenticated user, with the request meta', async () => {
    await logout(presented, USER, META);

    expect(sessionRepository.revokeSessionWithLogoutAuditTx).toHaveBeenCalledTimes(1);
    expect(sessionRepository.revokeSessionWithLogoutAuditTx).toHaveBeenCalledWith({
      tokenHash: hashToken(presented),
      userId: USER.id,
      meta: META,
    });
  });

  it('never passes the raw token on', async () => {
    await logout(presented, USER, META);

    expect(
      JSON.stringify(sessionRepository.revokeSessionWithLogoutAuditTx.mock.calls),
    ).not.toContain(presented);
  });

  it('resolves with nothing when a session was revoked', async () => {
    await expect(logout(presented, USER, META)).resolves.toBeUndefined();
  });

  it('resolves the same way for an unknown, foreign or already revoked token', async () => {
    sessionRepository.revokeSessionWithLogoutAuditTx.mockResolvedValue(false);

    await expect(logout(presented, USER, META)).resolves.toBeUndefined();
  });

  it('is not a theft signal: no revoke-all and no lookup of the session', async () => {
    sessionRepository.revokeSessionWithLogoutAuditTx.mockResolvedValue(false);

    await logout(presented, USER, META);

    expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
    expect(sessionRepository.findByTokenHash).not.toHaveBeenCalled();
  });

  it('uses the id of the authenticated user, whatever other fields req.user has', async () => {
    await logout(presented, { id: 'other-user', role: 'ADMIN', status: 'ACTIVE' }, META);

    expect(sessionRepository.revokeSessionWithLogoutAuditTx.mock.calls[0][0].userId).toBe(
      'other-user',
    );
  });

  it('propagates a database error (500) instead of pretending success', async () => {
    const dbError = new Error('db down');
    sessionRepository.revokeSessionWithLogoutAuditTx.mockRejectedValue(dbError);

    await expect(logout(presented, USER, META)).rejects.toBe(dbError);
  });
});
