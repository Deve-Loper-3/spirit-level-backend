const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { deleteStaleSessions } = require('../../src/repositories/session.repository');
const { hashToken } = require('../../src/utils/token.util');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query) exceeds jest's 5s default.
jest.setTimeout(30000);

const DAY_MS = 24 * 60 * 60 * 1000;

// deleteStaleSessions is not scoped to a user, so on the shared dev database it would also delete
// other people's stale rows. To stay safe the test uses a huge grace (10 years): only rows older
// than that are deleted, and the test creates the only ones.
const GRACE_MS = 3650 * DAY_MS;
const NOW = new Date('2026-10-11T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
const WAY_BEFORE_GRACE = GRACE_MS + 30 * DAY_MS;
const INSIDE_GRACE = GRACE_MS - 30 * DAY_MS;

describe('session.repository - deleteStaleSessions', () => {
  const testData = createTestData('session_cleanup');
  const createdIds = [];

  // Each test starts clean: leftovers of an earlier test would be counted when `now` moves forward.
  afterEach(async () => {
    await prisma.refreshSession.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const createSession = async (userId, { expiresAt, revokedAt = null }) => {
    const session = await prisma.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        tokenHash: hashToken(crypto.randomUUID()),
        expiresAt,
        revokedAt,
      },
    });
    createdIds.push(session.id);
    return session;
  };

  const exists = async (session) =>
    (await prisma.refreshSession.findUnique({ where: { id: session.id } })) !== null;

  it('deletes old expired and old revoked rows and keeps everything else', async () => {
    const user = await testData.createUser();
    const other = await testData.createUser();
    const future = new Date(NOW.getTime() + 30 * DAY_MS);

    const oldExpired = await createSession(user.id, { expiresAt: ago(WAY_BEFORE_GRACE) });
    const oldRevoked = await createSession(user.id, {
      expiresAt: future,
      revokedAt: ago(WAY_BEFORE_GRACE),
    });
    const oldExpiredAndRevoked = await createSession(user.id, {
      expiresAt: ago(WAY_BEFORE_GRACE),
      revokedAt: ago(WAY_BEFORE_GRACE),
    });
    const recentRevoked = await createSession(user.id, {
      expiresAt: future,
      revokedAt: ago(INSIDE_GRACE),
    });
    const recentlyExpired = await createSession(user.id, { expiresAt: ago(INSIDE_GRACE) });
    const active = await createSession(user.id, { expiresAt: future });
    const otherActive = await createSession(other.id, { expiresAt: future });
    const otherRecentRevoked = await createSession(other.id, {
      expiresAt: future,
      revokedAt: ago(INSIDE_GRACE),
    });

    const count = await deleteStaleSessions(GRACE_MS, NOW);

    expect(count).toBe(3);
    expect(await exists(oldExpired)).toBe(false);
    expect(await exists(oldRevoked)).toBe(false);
    expect(await exists(oldExpiredAndRevoked)).toBe(false);
    expect(await exists(recentRevoked)).toBe(true);
    expect(await exists(recentlyExpired)).toBe(true);
    expect(await exists(active)).toBe(true);
    expect(await exists(otherActive)).toBe(true);
    expect(await exists(otherRecentRevoked)).toBe(true);
  });

  it('keeps an expired but never revoked row that is still inside the grace', async () => {
    const user = await testData.createUser();
    const session = await createSession(user.id, { expiresAt: ago(INSIDE_GRACE) });

    await deleteStaleSessions(GRACE_MS, NOW);

    expect(await exists(session)).toBe(true);
  });

  it('measures the grace from now: the cutoff moves with the given time', async () => {
    const user = await testData.createUser();
    const session = await createSession(user.id, { expiresAt: ago(INSIDE_GRACE) });

    expect(await deleteStaleSessions(GRACE_MS, NOW)).toBe(0);
    expect(await exists(session)).toBe(true);

    const muchLater = new Date(NOW.getTime() + 60 * DAY_MS);
    expect(await deleteStaleSessions(GRACE_MS, muchLater)).toBe(1);
    expect(await exists(session)).toBe(false);
  });

  it('returns 0 when there is nothing to delete', async () => {
    expect(await deleteStaleSessions(GRACE_MS, NOW)).toBe(0);
  });

  it('is repeatable: a second run deletes nothing more', async () => {
    const user = await testData.createUser();
    await createSession(user.id, { expiresAt: ago(WAY_BEFORE_GRACE) });

    expect(await deleteStaleSessions(GRACE_MS, NOW)).toBe(1);
    expect(await deleteStaleSessions(GRACE_MS, NOW)).toBe(0);
  });

  it.each([[0], [-1], [NaN], [undefined], [null]])(
    'rejects a grace of %p so reuse detection always keeps revoked rows',
    async (grace) => {
      const user = await testData.createUser();
      const session = await createSession(user.id, { expiresAt: ago(WAY_BEFORE_GRACE) });

      await expect(deleteStaleSessions(grace, NOW)).rejects.toThrow(RangeError);
      expect(await exists(session)).toBe(true);
    },
  );
});
