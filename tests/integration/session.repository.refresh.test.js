const prisma = require('../../src/config/prisma');
const {
  createLoginSessionTx,
  findByTokenHash,
  revokeById,
  revokeAllByUser,
  rotate,
} = require('../../src/repositories/session.repository');
const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const META = { ipAddress: '203.0.113.9', userAgent: 'jest-agent/2.0' };

describe('session.repository - refresh session functions', () => {
  const testData = createTestData('refresh_session');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const newSessionData = (userId) => {
    const rawToken = generateRefreshToken();
    return {
      rawToken,
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        meta: META,
      },
    };
  };

  const login = async (userId) => {
    const { rawToken, data } = newSessionData(userId);
    const { sessionId } = await createLoginSessionTx({ ...data, now: new Date() });
    return { rawToken, sessionId, tokenHash: data.tokenHash };
  };

  const findRow = (id) => prisma.refreshSession.findUnique({ where: { id } });

  describe('findByTokenHash', () => {
    it('returns only id, userId, expiresAt and revokedAt', async () => {
      const user = await testData.createUser();
      const { sessionId, tokenHash } = await login(user.id);

      const found = await findByTokenHash(tokenHash);

      expect(Object.keys(found).sort()).toEqual(['expiresAt', 'id', 'revokedAt', 'userId']);
      expect(found).toMatchObject({ id: sessionId, userId: user.id, revokedAt: null });
    });

    it('returns null for an unknown hash', async () => {
      expect(await findByTokenHash(hashToken(generateRefreshToken()))).toBeNull();
    });

    it('does not match the raw token, only its hash', async () => {
      const user = await testData.createUser();
      const { rawToken } = await login(user.id);

      expect(await findByTokenHash(rawToken)).toBeNull();
    });
  });

  describe('revokeById', () => {
    it('revokes an active session and returns true', async () => {
      const user = await testData.createUser();
      const { sessionId } = await login(user.id);
      const now = new Date();

      expect(await revokeById(sessionId, now)).toBe(true);
      expect((await findRow(sessionId)).revokedAt).toEqual(now);
    });

    it('returns false and keeps the first revokedAt when already revoked', async () => {
      const user = await testData.createUser();
      const { sessionId } = await login(user.id);
      const first = new Date('2026-01-01T00:00:00Z');
      await revokeById(sessionId, first);

      expect(await revokeById(sessionId, new Date())).toBe(false);
      expect((await findRow(sessionId)).revokedAt).toEqual(first);
    });

    it('returns false for an unknown id', async () => {
      expect(await revokeById('00000000-0000-4000-8000-000000000000')).toBe(false);
    });
  });

  describe('revokeAllByUser', () => {
    it('revokes only that user’s active sessions and returns the count', async () => {
      const user = await testData.createUser();
      const other = await testData.createUser();
      const a = await login(user.id);
      const b = await login(user.id);
      const alreadyRevoked = await login(user.id);
      const otherSession = await login(other.id);
      const earlier = new Date('2026-01-01T00:00:00Z');
      await revokeById(alreadyRevoked.sessionId, earlier);
      const now = new Date();

      expect(await revokeAllByUser(user.id, now)).toBe(2);

      expect((await findRow(a.sessionId)).revokedAt).toEqual(now);
      expect((await findRow(b.sessionId)).revokedAt).toEqual(now);
      expect((await findRow(alreadyRevoked.sessionId)).revokedAt).toEqual(earlier);
      expect((await findRow(otherSession.sessionId)).revokedAt).toBeNull();
    });

    it('returns 0 when the user has no active sessions', async () => {
      const user = await testData.createUser();

      expect(await revokeAllByUser(user.id)).toBe(0);
    });
  });

  describe('rotate', () => {
    it('revokes the old session and creates the new one with only its hash', async () => {
      const user = await testData.createUser();
      const old = await login(user.id);
      const next = newSessionData(user.id);
      const now = new Date();

      const result = await rotate(old.sessionId, next.data, now);

      expect(Object.keys(result)).toEqual(['sessionId']);
      expect((await findRow(old.sessionId)).revokedAt).toEqual(now);
      const created = await findRow(result.sessionId);
      expect(created).toMatchObject({
        userId: user.id,
        tokenHash: next.data.tokenHash,
        revokedAt: null,
        ipAddress: META.ipAddress,
        userAgent: META.userAgent,
      });
      expect(created.expiresAt).toEqual(next.data.expiresAt);
      expect(Object.values(created)).not.toContain(next.rawToken);
    });

    it('returns null and creates nothing when the old session is already revoked', async () => {
      const user = await testData.createUser();
      const old = await login(user.id);
      const revokedAt = new Date('2026-01-01T00:00:00Z');
      await revokeById(old.sessionId, revokedAt);
      const next = newSessionData(user.id);

      expect(await rotate(old.sessionId, next.data)).toBeNull();

      expect((await findRow(old.sessionId)).revokedAt).toEqual(revokedAt);
      expect(await findByTokenHash(next.data.tokenHash)).toBeNull();
    });

    it('returns null for an unknown old session id', async () => {
      const user = await testData.createUser();
      const next = newSessionData(user.id);

      expect(await rotate('00000000-0000-4000-8000-000000000000', next.data)).toBeNull();
      expect(await findByTokenHash(next.data.tokenHash)).toBeNull();
    });

    it('lets exactly one of two parallel rotations win', async () => {
      const user = await testData.createUser();
      const old = await login(user.id);
      const first = newSessionData(user.id);
      const second = newSessionData(user.id);

      const results = await Promise.all([
        rotate(old.sessionId, first.data),
        rotate(old.sessionId, second.data),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const stored = await prisma.refreshSession.findMany({
        where: { tokenHash: { in: [first.data.tokenHash, second.data.tokenHash] } },
      });
      expect(stored).toHaveLength(1);
    });

    it('rolls back the revoke when creating the new session fails', async () => {
      const user = await testData.createUser();
      const old = await login(user.id);
      const duplicate = await login(user.id);

      // tokenHash is unique, so reusing an existing hash makes the insert fail (P2002).
      await expect(
        rotate(old.sessionId, { ...newSessionData(user.id).data, tokenHash: duplicate.tokenHash }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect((await findRow(old.sessionId)).revokedAt).toBeNull();
    });
  });
});
