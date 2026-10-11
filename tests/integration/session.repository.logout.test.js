const crypto = require('crypto');

// Calls the real createAuditLog unless a test makes it fail (rollback test).
jest.mock('../../src/repositories/audit-log.repository', () => {
  const actual = jest.requireActual('../../src/repositories/audit-log.repository');
  return { ...actual, createAuditLog: jest.fn(actual.createAuditLog) };
});

const prisma = require('../../src/config/prisma');
const {
  createLoginSessionTx,
  revokeSessionWithLogoutAuditTx,
} = require('../../src/repositories/session.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const { AuditAction } = require('../../src/constants/audit');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const META = { ipAddress: '203.0.113.7', userAgent: 'jest-agent/3.0' };

describe('session.repository - revokeSessionWithLogoutAuditTx', () => {
  const testData = createTestData('logout_tx');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  // Same way the app creates a session: through createLoginSessionTx (its LOGIN_SUCCESS row
  // is why every user here starts with exactly one audit row).
  const login = async (user) => {
    const rawToken = generateRefreshToken();
    const tokenHash = hashToken(rawToken);
    const { sessionId } = await createLoginSessionTx({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      now: new Date(),
      meta: META,
    });
    return { rawToken, tokenHash, sessionId };
  };

  const findSession = (id) => prisma.refreshSession.findUnique({ where: { id } });
  const logoutRows = (userId) =>
    prisma.auditLog.findMany({ where: { userId, action: AuditAction.LOGOUT } });

  it('revokes the session, returns true and writes one LOGOUT audit row', async () => {
    const user = await testData.createUser();
    const { tokenHash, sessionId } = await login(user);
    const now = new Date();

    const result = await revokeSessionWithLogoutAuditTx({
      tokenHash,
      userId: user.id,
      now,
      meta: META,
    });

    expect(result).toBe(true);
    expect((await findSession(sessionId)).revokedAt).toEqual(now);
    const rows = await logoutRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      action: AuditAction.LOGOUT,
      email: user.email,
      ipAddress: META.ipAddress,
      userAgent: META.userAgent,
      reason: null,
      actorId: null,
      actorRole: null,
    });
  });

  it('stores NULL ip and user agent when no meta is given', async () => {
    const user = await testData.createUser();
    const { tokenHash } = await login(user);

    await revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id });

    const [row] = await logoutRows(user.id);
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
  });

  it('writes no token or hash into the audit row', async () => {
    const user = await testData.createUser();
    const { rawToken, tokenHash } = await login(user);

    await revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id, meta: META });

    const serialized = JSON.stringify(await logoutRows(user.id));
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(tokenHash);
  });

  it('unknown token: returns false and writes nothing', async () => {
    const user = await testData.createUser();
    const { sessionId } = await login(user);

    const result = await revokeSessionWithLogoutAuditTx({
      tokenHash: hashToken(crypto.randomUUID()),
      userId: user.id,
      meta: META,
    });

    expect(result).toBe(false);
    expect((await findSession(sessionId)).revokedAt).toBeNull();
    expect(await logoutRows(user.id)).toHaveLength(0);
  });

  it("another user's token: returns false, session untouched, no audit row for either user", async () => {
    const owner = await testData.createUser();
    const caller = await testData.createUser();
    const { tokenHash, sessionId } = await login(owner);

    const result = await revokeSessionWithLogoutAuditTx({
      tokenHash,
      userId: caller.id,
      meta: META,
    });

    expect(result).toBe(false);
    expect((await findSession(sessionId)).revokedAt).toBeNull();
    expect(await logoutRows(owner.id)).toHaveLength(0);
    expect(await logoutRows(caller.id)).toHaveLength(0);
  });

  it('already revoked token: returns false, keeps the first revokedAt, adds no audit row', async () => {
    const user = await testData.createUser();
    const { tokenHash, sessionId } = await login(user);
    const first = new Date('2026-01-01T00:00:00Z');
    await revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id, now: first, meta: META });

    const second = await revokeSessionWithLogoutAuditTx({
      tokenHash,
      userId: user.id,
      now: new Date(),
      meta: META,
    });

    expect(second).toBe(false);
    expect((await findSession(sessionId)).revokedAt).toEqual(first);
    expect(await logoutRows(user.id)).toHaveLength(1);
  });

  it("revokes only that session: the user's other sessions stay active", async () => {
    const user = await testData.createUser();
    const first = await login(user);
    const second = await login(user);

    await revokeSessionWithLogoutAuditTx({
      tokenHash: first.tokenHash,
      userId: user.id,
      meta: META,
    });

    expect((await findSession(first.sessionId)).revokedAt).not.toBeNull();
    expect((await findSession(second.sessionId)).revokedAt).toBeNull();
  });

  it('two parallel calls with the same token: exactly one wins and one audit row exists', async () => {
    const user = await testData.createUser();
    const { tokenHash } = await login(user);

    const results = await Promise.all([
      revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id, meta: META }),
      revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id, meta: META }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await logoutRows(user.id)).toHaveLength(1);
  });

  it('rolls the revoke back when the audit write fails', async () => {
    const user = await testData.createUser();
    const { tokenHash, sessionId } = await login(user);
    createAuditLog.mockRejectedValueOnce(new Error('audit down'));

    await expect(
      revokeSessionWithLogoutAuditTx({ tokenHash, userId: user.id, meta: META }),
    ).rejects.toThrow('audit down');

    expect((await findSession(sessionId)).revokedAt).toBeNull();
    expect(await logoutRows(user.id)).toHaveLength(0);
  });
});
