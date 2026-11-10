jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/utils/password.util');

const { registerMember } = require('../../src/services/auth.service');
const userRepository = require('../../src/repositories/user.repository');
const { hashPassword } = require('../../src/utils/password.util');
const { Gender } = require('../../src/constants/gender');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');

const INPUT = {
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+12025550100',
  gender: Gender.FEMALE,
  password: 'Str0ng!Passw0rd',
};
const IMAGE_URL = 'https://store.public.blob.vercel-storage.com/profile-images/abc.png';

describe('auth.service - registerMember', () => {
  beforeEach(() => {
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.createUser.mockImplementation(async (data) => ({
      ...data,
      createdAt: new Date(),
    }));
    hashPassword.mockResolvedValue('hashed');
  });

  it('stores profileImageUrl null when no image URL is given', async () => {
    const result = await registerMember(INPUT);

    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ profileImageUrl: null, passwordHash: 'hashed' }),
    );
    expect(result.profileImageUrl).toBeNull();
    expect(result.passwordHash).toBeUndefined();
  });

  it('stores and returns the submitted profileImageUrl', async () => {
    const result = await registerMember({ ...INPUT, profileImageUrl: IMAGE_URL });

    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ profileImageUrl: IMAGE_URL }),
    );
    expect(result.profileImageUrl).toBe(IMAGE_URL);
  });

  it('always creates a PENDING MEMBER', async () => {
    await registerMember(INPUT);

    expect(userRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.MEMBER, status: AccountStatus.PENDING }),
    );
  });

  it('returns 409 for an existing email without hashing or creating', async () => {
    userRepository.findByEmail.mockResolvedValue({ id: 'existing' });

    await expect(registerMember({ ...INPUT, profileImageUrl: IMAGE_URL })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(hashPassword).not.toHaveBeenCalled();
    expect(userRepository.createUser).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race on createUser to 409 USER_ALREADY_EXISTS', async () => {
    const dbError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    userRepository.createUser.mockRejectedValue(dbError);

    await expect(registerMember({ ...INPUT, profileImageUrl: IMAGE_URL })).rejects.toMatchObject({
      statusCode: 409,
      code: 'USER_ALREADY_EXISTS',
    });
  });

  it('propagates any other createUser failure unchanged', async () => {
    const dbError = new Error('connection lost');
    userRepository.createUser.mockRejectedValue(dbError);

    await expect(registerMember({ ...INPUT, profileImageUrl: IMAGE_URL })).rejects.toBe(dbError);
  });
});
