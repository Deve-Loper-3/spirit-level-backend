const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { createLoginSessionTx } = require('../../src/repositories/session.repository');
const { AuditAction } = require('../../src/constants/audit');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const META = { ipAddress: '203.0.113.7', userAgent: 'jest-agent/1.0' };

describe('session.repository - createLoginSessionTx', () => {
  const testData = createTestData('login_session');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const buildInput = (userId, overrides = {}) => {
    const rawToken = generateRefreshToken();
    return {
      rawToken,
      input: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        now: new Date(),
        meta: META,
        ...overrides,
      },
    };
  };

  it('sets user.lastLoginAt to the given time', async () => {
    const user = await testData.createUser();
    const { input } = buildInput(user.id);

    await createLoginSessionTx(input);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(user.lastLoginAt).toBeNull();
    expect(stored.lastLoginAt).toEqual(input.now);
  });

  it('stores the token HASH in the session row, never the raw token', async () => {
    const user = await testData.createUser();
    const { rawToken, input } = buildInput(user.id);

    const { sessionId } = await createLoginSessionTx(input);

    const session = await prisma.refreshSession.findUnique({ where: { id: sessionId } });
    expect(session).toMatchObject({
      userId: user.id,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      ipAddress: META.ipAddress,
      userAgent: META.userAgent,
      revokedAt: null,
    });
    expect(session.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(session)).not.toContain(rawToken);
  });

  it('writes a LOGIN_SUCCESS audit row with the user email, ip and user agent', async () => {
    const user = await testData.createUser();
    const { input } = buildInput(user.id);

    await createLoginSessionTx(input);

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: AuditAction.LOGIN_SUCCESS,
      reason: null,
      email: user.email,
      ipAddress: META.ipAddress,
      userAgent: META.userAgent,
    });
  });

  it('returns only the new session id', async () => {
    const user = await testData.createUser();
    const { input } = buildInput(user.id);

    const result = await createLoginSessionTx(input);

    expect(result).toEqual({ sessionId: expect.any(String) });
  });

  it('stores NULL ip and user agent when meta is omitted', async () => {
    const user = await testData.createUser();
    const { input } = buildInput(user.id, { meta: undefined });

    const { sessionId } = await createLoginSessionTx(input);

    const session = await prisma.refreshSession.findUnique({ where: { id: sessionId } });
    const log = await prisma.auditLog.findFirst({ where: { userId: user.id } });
    expect([session.ipAddress, session.userAgent, log.ipAddress, log.userAgent]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  describe('all-or-nothing', () => {
    it('writes nothing when the session insert fails (duplicate token hash)', async () => {
      const firstUser = await testData.createUser();
      const secondUser = await testData.createUser();
      const { input } = buildInput(firstUser.id);
      await createLoginSessionTx(input);

      const duplicate = { ...input, userId: secondUser.id, now: new Date() };
      await expect(createLoginSessionTx(duplicate)).rejects.toMatchObject({ code: 'P2002' });

      const stored = await prisma.user.findUnique({ where: { id: secondUser.id } });
      expect(stored.lastLoginAt).toBeNull();
      expect(await prisma.refreshSession.count({ where: { userId: secondUser.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { userId: secondUser.id } })).toBe(0);
      expect(await prisma.refreshSession.count({ where: { userId: firstUser.id } })).toBe(1);
    });

    it('writes nothing when the user does not exist', async () => {
      const { input } = buildInput(crypto.randomUUID());

      await expect(createLoginSessionTx(input)).rejects.toMatchObject({ code: 'P2025' });

      expect(await prisma.refreshSession.count({ where: { tokenHash: input.tokenHash } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { userId: input.userId } })).toBe(0);
    });
  });
});
