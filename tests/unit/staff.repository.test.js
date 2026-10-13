const prisma = require('../../src/config/prisma');
const { AccountStatus } = require('../../src/constants/status');
const { STAFF_DEFAULT_GENDER } = require('../../src/constants/gender');
const { Role } = require('../../src/constants/roles');
const { createStaffUser } = require('../../src/repositories/staff.repository');

jest.mock('../../src/config/prisma', () => ({
  user: {
    create: jest.fn(),
  },
}));

describe('staff.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createStaffUser', () => {
    it('creates staff user with default prisma client when tx is not provided', async () => {
      const mockUser = {
        id: 'u-1',
        fullName: 'Coach John',
        email: 'coach@example.com',
        phone: '+15551234567',
        role: Role.COACH,
        passwordHash: 'hashed',
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
        gender: STAFF_DEFAULT_GENDER,
      };
      prisma.user.create.mockResolvedValue(mockUser);

      const input = {
        id: 'u-1',
        fullName: 'Coach John',
        email: 'coach@example.com',
        phone: '+15551234567',
        role: Role.COACH,
        passwordHash: 'hashed',
      };

      const result = await createStaffUser(input);

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          ...input,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
          gender: STAFF_DEFAULT_GENDER,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('creates staff user using transaction client when tx is provided', async () => {
      const tx = {
        user: {
          create: jest.fn().mockResolvedValue({ id: 'u-tx-1' }),
        },
      };

      const input = {
        id: 'u-tx-1',
        fullName: 'Admin Jane',
        email: 'admin@example.com',
        phone: '+15559876543',
        role: Role.ADMIN,
        passwordHash: 'hashed-admin',
      };

      const result = await createStaffUser(input, tx);

      expect(tx.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tx.user.create).toHaveBeenCalledWith({
        data: {
          ...input,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
          gender: STAFF_DEFAULT_GENDER,
        },
      });
      expect(result).toEqual({ id: 'u-tx-1' });
    });
  });
});
