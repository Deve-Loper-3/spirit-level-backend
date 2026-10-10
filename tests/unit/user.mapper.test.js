const { toPublicUser, toCompletedRegistration } = require('../../src/repositories/user.mapper');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');

describe('user.mapper', () => {
  describe('toCompletedRegistration', () => {
    it('returns only id, status, and registrationCompletedAt, ignoring other properties', () => {
      const completionDate = new Date('2026-10-04T09:00:00.000Z');
      const input = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        status: AccountStatus.ACTIVE,
        registrationCompletedAt: completionDate,
        passwordHash: 'secret-hash',
        email: 'member@test.invalid',
        phone: '+12025550100',
        role: Role.MEMBER,
        waiverAcceptedAt: completionDate,
        extraData: 'should-be-ignored',
      };

      const result = toCompletedRegistration(input);

      expect(result).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        status: AccountStatus.ACTIVE,
        registrationCompletedAt: completionDate,
      });
      expect(result.passwordHash).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.phone).toBeUndefined();
      expect(result.role).toBeUndefined();
      expect(result.waiverAcceptedAt).toBeUndefined();
      expect(result.extraData).toBeUndefined();
    });
  });

  describe('toPublicUser', () => {
    it('returns all safe public fields and excludes sensitive data like passwordHash', () => {
      const createdAt = new Date('2026-10-04T08:00:00.000Z');
      const input = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+12025550100',
        whatsappNumber: '+12025550101',
        gender: Gender.FEMALE,
        birthDay: 15,
        birthMonth: 8,
        role: Role.MEMBER,
        status: AccountStatus.PENDING,
        createdAt,
        passwordHash: 'super-secret-bcrypt-hash',
        updatedAt: new Date('2026-10-04T08:30:00.000Z'),
      };

      const result = toPublicUser(input);

      expect(result).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+12025550100',
        whatsappNumber: '+12025550101',
        gender: Gender.FEMALE,
        birthDay: 15,
        birthMonth: 8,
        profileImageUrl: null,
        role: Role.MEMBER,
        status: AccountStatus.PENDING,
        createdAt,
      });
      expect(result.passwordHash).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
    });

    it('returns profileImageUrl when the user has one', () => {
      const url = 'https://abc.public.blob.vercel-storage.com/profiles/photo-xyz.png';

      const result = toPublicUser({ id: 'user-1', profileImageUrl: url });

      expect(result.profileImageUrl).toBe(url);
    });
  });
});
