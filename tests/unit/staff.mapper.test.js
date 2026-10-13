const { toStaffResponse } = require('../../src/repositories/staff.mapper');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');

describe('staff.mapper - toStaffResponse', () => {
  it('maps user to public staff shape with fullName', () => {
    const user = {
      id: 'usr_123',
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+12025551234',
      role: Role.COACH,
      status: AccountStatus.ACTIVE,
    };

    const response = toStaffResponse(user);

    expect(response).toEqual({
      id: 'usr_123',
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+12025551234',
      role: Role.COACH,
      status: AccountStatus.ACTIVE,
    });
  });

  it('never leaks sensitive or internal fields (password, hash, mustChangePassword, gender, etc.)', () => {
    const user = {
      id: 'usr_sensitive',
      fullName: 'Protected Staff',
      email: 'safe@example.com',
      phone: '+12025554321',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      password: 'PlainPassword123',
      passwordHash: '$2b$12$eX4mpL3h4shD0n0tL34k...',
      mustChangePassword: true,
      gender: Gender.PREFER_NOT_TO_SAY,
      waiverAcceptedAt: new Date(),
      registrationCompletedAt: new Date(),
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const response = toStaffResponse(user);

    expect(response).toEqual({
      id: 'usr_sensitive',
      fullName: 'Protected Staff',
      email: 'safe@example.com',
      phone: '+12025554321',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
    });

    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('mustChangePassword');
    expect(response).not.toHaveProperty('gender');
    expect(response).not.toHaveProperty('waiverAcceptedAt');
    expect(response).not.toHaveProperty('registrationCompletedAt');
    expect(response).not.toHaveProperty('lastLoginAt');
    expect(response).not.toHaveProperty('createdAt');
    expect(response).not.toHaveProperty('updatedAt');
    expect(response).not.toHaveProperty('firstName');
    expect(response).not.toHaveProperty('lastName');
  });
});
