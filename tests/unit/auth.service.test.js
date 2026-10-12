const { completeMemberRegistration, getAuthenticatedUser } = require('../../src/services/auth.service');
const userRepository = require('../../src/repositories/user.repository');
const { AccountStatus } = require('../../src/constants/status');
const { AppErrors } = require('../../src/constants/errors');

jest.mock('../../src/repositories/user.repository');

describe('auth.service - completeMemberRegistration', () => {
  const validInput = {
    registrationId: '123e4567-e89b-12d3-a456-426614174000',
    emergencyContact: {
      name: 'Jane Doe',
      phone: '+12025550199',
      relationship: 'SPOUSE',
    },
    waiverAccepted: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes registration on success path and returns mapped completion response', async () => {
    const mockUser = {
      id: validInput.registrationId,
      phone: '+12025550100',
      status: AccountStatus.PENDING,
    };
    const now = new Date('2026-10-04T09:00:00.000Z');

    userRepository.findById.mockResolvedValue(mockUser);
    userRepository.completeRegistrationTx.mockResolvedValue({
      id: mockUser.id,
      status: AccountStatus.ACTIVE,
      registrationCompletedAt: now,
    });

    const result = await completeMemberRegistration(validInput);

    expect(userRepository.findById).toHaveBeenCalledWith(validInput.registrationId);
    expect(userRepository.completeRegistrationTx).toHaveBeenCalledWith({
      userId: mockUser.id,
      contact: validInput.emergencyContact,
      now: expect.any(Date),
    });
    expect(result).toEqual({
      id: mockUser.id,
      status: AccountStatus.ACTIVE,
      registrationCompletedAt: now,
    });
  });

  it('throws USER_NOT_FOUND and never calls completeRegistrationTx when user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(completeMemberRegistration(validInput)).rejects.toMatchObject({
      statusCode: AppErrors.USER_NOT_FOUND.statusCode,
      message: AppErrors.USER_NOT_FOUND.message,
    });

    expect(userRepository.completeRegistrationTx).not.toHaveBeenCalled();
  });

  it('throws REGISTRATION_ALREADY_COMPLETED and never calls completeRegistrationTx when user is already ACTIVE', async () => {
    userRepository.findById.mockResolvedValue({
      id: validInput.registrationId,
      phone: '+12025550100',
      status: AccountStatus.ACTIVE,
    });

    await expect(completeMemberRegistration(validInput)).rejects.toMatchObject({
      statusCode: AppErrors.REGISTRATION_ALREADY_COMPLETED.statusCode,
      message: AppErrors.REGISTRATION_ALREADY_COMPLETED.message,
    });

    expect(userRepository.completeRegistrationTx).not.toHaveBeenCalled();
  });

  it('throws ACCOUNT_NOT_ELIGIBLE and never calls completeRegistrationTx when user is DISABLED', async () => {
    userRepository.findById.mockResolvedValue({
      id: validInput.registrationId,
      phone: '+12025550100',
      status: AccountStatus.DISABLED,
    });

    await expect(completeMemberRegistration(validInput)).rejects.toMatchObject({
      statusCode: AppErrors.ACCOUNT_NOT_ELIGIBLE.statusCode,
      message: AppErrors.ACCOUNT_NOT_ELIGIBLE.message,
    });

    expect(userRepository.completeRegistrationTx).not.toHaveBeenCalled();
  });

  it('throws EMERGENCY_PHONE_SAME_AS_MEMBER and never calls completeRegistrationTx when phone matches member', async () => {
    userRepository.findById.mockResolvedValue({
      id: validInput.registrationId,
      phone: validInput.emergencyContact.phone, // Same phone
      status: AccountStatus.PENDING,
    });

    await expect(completeMemberRegistration(validInput)).rejects.toMatchObject({
      statusCode: AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.statusCode,
      message: AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.message,
    });

    expect(userRepository.completeRegistrationTx).not.toHaveBeenCalled();
  });
});

describe('auth.service - getAuthenticatedUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns public mapped user when user is found', async () => {
    const mockUser = {
      id: 'user-uuid-1',
      fullName: 'Alice Walker',
      email: 'alice@example.com',
      phone: '+12025550199',
      whatsappNumber: null,
      gender: 'FEMALE',
      birthDay: 15,
      birthMonth: 5,
      profileImageUrl: 'https://blob.example.com/alice.png',
      role: 'MEMBER',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    userRepository.findProfileById.mockResolvedValue(mockUser);

    const result = await getAuthenticatedUser('user-uuid-1');

    expect(userRepository.findProfileById).toHaveBeenCalledWith('user-uuid-1');
    expect(result).toEqual({
      id: 'user-uuid-1',
      fullName: 'Alice Walker',
      email: 'alice@example.com',
      phone: '+12025550199',
      whatsappNumber: null,
      gender: 'FEMALE',
      birthDay: 15,
      birthMonth: 5,
      profileImageUrl: 'https://blob.example.com/alice.png',
      role: 'MEMBER',
      status: 'ACTIVE',
      createdAt: mockUser.createdAt,
    });
    expect(result.passwordHash).toBeUndefined();
  });

  it('throws USER_NOT_FOUND when user does not exist', async () => {
    userRepository.findProfileById.mockResolvedValue(null);

    await expect(getAuthenticatedUser('missing-id')).rejects.toMatchObject({
      statusCode: AppErrors.USER_NOT_FOUND.statusCode,
      message: AppErrors.USER_NOT_FOUND.message,
    });
  });
});
