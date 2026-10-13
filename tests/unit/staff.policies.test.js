const { canCreate } = require('../../src/services/staff.policies');
const { Role } = require('../../src/constants/roles');

describe('staff.policies - canCreate', () => {
  describe('when caller is OWNER', () => {
    it('allows creating COACH', () => {
      expect(canCreate(Role.OWNER, Role.COACH)).toBe(true);
    });

    it('allows creating ADMIN', () => {
      expect(canCreate(Role.OWNER, Role.ADMIN)).toBe(true);
    });

    it('allows creating OWNER', () => {
      expect(canCreate(Role.OWNER, Role.OWNER)).toBe(true);
    });

    it('denies creating MEMBER', () => {
      expect(canCreate(Role.OWNER, Role.MEMBER)).toBe(false);
    });
  });

  describe('when caller is ADMIN', () => {
    it('allows creating COACH', () => {
      expect(canCreate(Role.ADMIN, Role.COACH)).toBe(true);
    });

    it('allows creating ADMIN', () => {
      expect(canCreate(Role.ADMIN, Role.ADMIN)).toBe(true);
    });

    it('denies creating OWNER', () => {
      expect(canCreate(Role.ADMIN, Role.OWNER)).toBe(false);
    });

    it('denies creating MEMBER', () => {
      expect(canCreate(Role.ADMIN, Role.MEMBER)).toBe(false);
    });
  });

  describe('when caller is COACH or MEMBER', () => {
    it.each([Role.COACH, Role.MEMBER])('denies %s from creating any role', (callerRole) => {
      expect(canCreate(callerRole, Role.COACH)).toBe(false);
      expect(canCreate(callerRole, Role.ADMIN)).toBe(false);
      expect(canCreate(callerRole, Role.OWNER)).toBe(false);
      expect(canCreate(callerRole, Role.MEMBER)).toBe(false);
    });
  });

  describe('when caller role is unknown or invalid', () => {
    it.each(['SUPERADMIN', 'admin', '', 'constructor', '__proto__', 'toString', undefined, null])(
      'returns false for caller role %j',
      (callerRole) => {
        expect(canCreate(callerRole, Role.COACH)).toBe(false);
        expect(canCreate(callerRole, Role.ADMIN)).toBe(false);
      },
    );
  });

  describe('when target role is unknown or invalid', () => {
    it.each(['SUPERADMIN', 'coach', '', 'constructor', undefined, null])(
      'returns false for target role %j',
      (targetRole) => {
        expect(canCreate(Role.OWNER, targetRole)).toBe(false);
        expect(canCreate(Role.ADMIN, targetRole)).toBe(false);
      },
    );
  });
});
