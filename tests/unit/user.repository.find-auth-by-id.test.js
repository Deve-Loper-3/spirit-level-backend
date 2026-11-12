jest.mock('../../src/config/prisma', () => ({ user: { findUnique: jest.fn() } }));

const prisma = require('../../src/config/prisma');
const { findAuthById } = require('../../src/repositories/user.repository');

describe('user.repository - findAuthById', () => {
  it('looks the user up by id and selects only id, email, role and status', async () => {
    const row = { id: 'user-1', email: 'a@test.invalid', role: 'ADMIN', status: 'ACTIVE' };
    prisma.user.findUnique.mockResolvedValue(row);

    const result = await findAuthById('user-1');

    expect(result).toBe(row);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, email: true, role: true, status: true },
    });
  });

  it('returns null when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    expect(await findAuthById('missing')).toBeNull();
  });
});
