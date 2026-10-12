jest.mock('../../src/config/prisma', () => ({ user: { findUnique: jest.fn() } }));

const prisma = require('../../src/config/prisma');
const { findPublicById } = require('../../src/repositories/user.repository');

describe('user.repository - findPublicById', () => {
  it('looks the user up by id and selects only public fields', async () => {
    const row = { id: 'user-1' };
    prisma.user.findUnique.mockResolvedValue(row);

    const result = await findPublicById('user-1');

    expect(result).toBe(row);
    const { where, select } = prisma.user.findUnique.mock.calls[0][0];
    expect(where).toEqual({ id: 'user-1' });
    expect(Object.keys(select).sort()).toEqual(
      [
        'id',
        'fullName',
        'email',
        'phone',
        'whatsappNumber',
        'gender',
        'birthDay',
        'birthMonth',
        'profileImageUrl',
        'role',
        'status',
        'createdAt',
      ].sort(),
    );
    expect(select.passwordHash).toBeUndefined();
  });

  it('returns null when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    expect(await findPublicById('missing')).toBeNull();
  });
});
