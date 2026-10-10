// The audit insert is the LAST step of the transaction. Forcing it to fail proves the two
// earlier writes (lastLoginAt, session) are rolled back too.
jest.mock('../../src/repositories/audit-log.repository', () => ({
  createAuditLog: jest.fn().mockRejectedValue(new Error('audit unavailable')),
}));

const prisma = require('../../src/config/prisma');
const { createLoginSessionTx } = require('../../src/repositories/session.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

describe('session.repository - createLoginSessionTx rollback', () => {
  const testData = createTestData('login_session_rollback');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('rolls back lastLoginAt and the session when the audit insert fails', async () => {
    const user = await testData.createUser();
    const tokenHash = hashToken(generateRefreshToken());

    await expect(
      createLoginSessionTx({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60000),
        now: new Date(),
      }),
    ).rejects.toThrow('audit unavailable');

    expect(createAuditLog).toHaveBeenCalledTimes(1);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.lastLoginAt).toBeNull();
    expect(await prisma.refreshSession.count({ where: { tokenHash } })).toBe(0);
  });
});
