jest.mock('../../src/repositories/user.repository');

const { getProfile } = require('../../src/services/auth.service');
const userRepository = require('../../src/repositories/user.repository');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');

describe('auth.service - getProfile', () => {
  it('returns the public shape of the user', async () => {
    userRepository.findPublicById.mockResolvedValue({
      id: 'user-1',
      fullName: 'Coach One',
      email: 'coach@test.invalid',
      role: Role.COACH,
      status: AccountStatus.ACTIVE,
      passwordHash: 'must-not-leak',
    });

    const result = await getProfile('user-1');

    expect(userRepository.findPublicById).toHaveBeenCalledWith('user-1');
    expect(result).toMatchObject({ id: 'user-1', role: Role.COACH });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('throws 401 INVALID_TOKEN when the user no longer exists', async () => {
    userRepository.findPublicById.mockResolvedValue(null);

    await expect(getProfile('gone')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_TOKEN',
    });
  });
});
