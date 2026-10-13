const prisma = require('../../src/config/prisma');
const { updateStatusIfCurrent } = require('../../src/repositories/user.repository');
const { AccountStatus } = require('../../src/constants/status');

jest.mock('../../src/config/prisma', () => ({
  user: { updateMany: jest.fn() },
}));

describe('user.repository - updateStatusIfCurrent', () => {
  const transition = { from: AccountStatus.ACTIVE, to: AccountStatus.DISABLED };

  it('only matches a user that currently has the `from` status', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const count = await updateStatusIfCurrent('u1', transition);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', status: AccountStatus.ACTIVE },
      data: { status: AccountStatus.DISABLED },
    });
    expect(count).toBe(1);
  });

  it('returns 0 when the user has another status, for example PENDING', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    expect(await updateStatusIfCurrent('u1', transition)).toBe(0);
  });

  it('uses the given transaction client instead of the default one', async () => {
    const tx = { user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma.user.updateMany.mockClear();

    await updateStatusIfCurrent('u1', transition, tx);

    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
