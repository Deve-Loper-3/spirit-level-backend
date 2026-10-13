const prisma = require('../../src/config/prisma');
const { revokeAllByUser } = require('../../src/repositories/session.repository');

jest.mock('../../src/config/prisma', () => ({
  refreshSession: { updateMany: jest.fn() },
}));

describe('session.repository - revokeAllByUser client parameter', () => {
  const now = new Date('2026-10-13T00:00:00.000Z');

  it('uses the default client when none is given (existing callers)', async () => {
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 3 });

    const count = await revokeAllByUser('u1', now);

    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: now },
    });
    expect(count).toBe(3);
  });

  it('uses the given transaction client and leaves the default client alone', async () => {
    const tx = { refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    prisma.refreshSession.updateMany.mockClear();

    const count = await revokeAllByUser('u1', now, tx);

    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: now },
    });
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(count).toBe(2);
  });
});
