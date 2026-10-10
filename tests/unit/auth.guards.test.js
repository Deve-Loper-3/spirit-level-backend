const {
  ensureUserExists,
  ensureNotActive,
  ensurePending,
  ensureEmergencyPhoneDiffers,
  registrationGuards,
  runGuards,
} = require('../../src/services/auth.guards');
const { AccountStatus } = require('../../src/constants/status');
const { AppErrors } = require('../../src/constants/errors');

describe('auth.guards', () => {
  describe('ensureUserExists', () => {
    it('passes when user exists', () => {
      expect(() => ensureUserExists({ user: { id: 'user-1' } })).not.toThrow();
    });

    it('throws USER_NOT_FOUND (404) when user is null or undefined', () => {
      expect(() => ensureUserExists({ user: null })).toThrow(
        expect.objectContaining({
          statusCode: AppErrors.USER_NOT_FOUND.statusCode,
          message: AppErrors.USER_NOT_FOUND.message,
        }),
      );

      expect(() => ensureUserExists({ user: undefined })).toThrow(
        expect.objectContaining({
          statusCode: AppErrors.USER_NOT_FOUND.statusCode,
          message: AppErrors.USER_NOT_FOUND.message,
        }),
      );
    });
  });

  describe('ensureNotActive', () => {
    it('passes when user status is PENDING', () => {
      expect(() =>
        ensureNotActive({ user: { status: AccountStatus.PENDING } }),
      ).not.toThrow();
    });

    it('throws REGISTRATION_ALREADY_COMPLETED (409) when user status is ACTIVE', () => {
      expect(() =>
        ensureNotActive({ user: { status: AccountStatus.ACTIVE } }),
      ).toThrow(
        expect.objectContaining({
          statusCode: AppErrors.REGISTRATION_ALREADY_COMPLETED.statusCode,
          message: AppErrors.REGISTRATION_ALREADY_COMPLETED.message,
        }),
      );
    });
  });

  describe('ensurePending', () => {
    it('passes when user status is PENDING', () => {
      expect(() =>
        ensurePending({ user: { status: AccountStatus.PENDING } }),
      ).not.toThrow();
    });

    it('throws ACCOUNT_NOT_ELIGIBLE (403) when user status is not PENDING (e.g. DISABLED)', () => {
      expect(() =>
        ensurePending({ user: { status: AccountStatus.DISABLED } }),
      ).toThrow(
        expect.objectContaining({
          statusCode: AppErrors.ACCOUNT_NOT_ELIGIBLE.statusCode,
          message: AppErrors.ACCOUNT_NOT_ELIGIBLE.message,
        }),
      );
    });
  });

  describe('ensureEmergencyPhoneDiffers', () => {
    it('passes when emergency contact phone differs from user phone', () => {
      const ctx = {
        user: { phone: '+12025550100' },
        input: { emergencyContact: { phone: '+12025550199' } },
      };
      expect(() => ensureEmergencyPhoneDiffers(ctx)).not.toThrow();
    });

    it('throws EMERGENCY_PHONE_SAME_AS_MEMBER (400) when emergency contact phone equals user phone', () => {
      const ctx = {
        user: { phone: '+12025550100' },
        input: { emergencyContact: { phone: '+12025550100' } },
      };
      expect(() => ensureEmergencyPhoneDiffers(ctx)).toThrow(
        expect.objectContaining({
          statusCode: AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.statusCode,
          message: AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.message,
        }),
      );
    });
  });

  describe('runGuards and registrationGuards chain', () => {
    it('has registrationGuards in the exact specified order', () => {
      expect(registrationGuards).toEqual([
        ensureUserExists,
        ensureNotActive,
        ensurePending,
        ensureEmergencyPhoneDiffers,
      ]);
    });

    it('executes all guards when all succeed', () => {
      const g1 = jest.fn();
      const g2 = jest.fn();
      const ctx = { foo: 'bar' };

      runGuards([g1, g2], ctx);

      expect(g1).toHaveBeenCalledWith(ctx);
      expect(g2).toHaveBeenCalledWith(ctx);
    });

    it('stops execution at the first failing guard and does not run subsequent guards', () => {
      const g1 = jest.fn();
      const g2 = jest.fn().mockImplementation(() => {
        throw new Error('Guard 2 failed');
      });
      const g3 = jest.fn();
      const ctx = { foo: 'bar' };

      expect(() => runGuards([g1, g2, g3], ctx)).toThrow('Guard 2 failed');

      expect(g1).toHaveBeenCalledWith(ctx);
      expect(g2).toHaveBeenCalledWith(ctx);
      expect(g3).not.toHaveBeenCalled();
    });
  });
});
