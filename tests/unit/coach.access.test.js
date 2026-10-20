const {
  isCoachManager,
  getListAccess,
  selectCoachView,
  assertCanSee,
  assertCanEdit,
  assertManager,
  editableFields,
} = require('../../src/services/coach.access');
const { Role } = require('../../src/constants/roles');
const {
  CoachStatus,
  ADMIN_COACH_UPDATE_FIELDS,
  COACH_SELF_UPDATE_FIELDS,
} = require('../../src/constants/coach');
const { AppErrors } = require('../../src/constants/errors');

const row = (overrides = {}) => ({
  id: 'coach-1',
  coachType: 'SALARIED',
  bio: 'Bio',
  status: CoachStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'user-1',
    fullName: 'Coach One',
    email: 'one@example.com',
    phone: '+15551234567',
    profileImageUrl: null,
  },
  ...overrides,
});

const inactive = () => row({ status: CoachStatus.INACTIVE });

const caller = (role, id = 'someone') => ({ id, role });
const own = (role = Role.COACH) => caller(role, 'user-1');

const expectCode = (fn, appError) => {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ statusCode: appError.statusCode, code: appError.code });
    return;
  }
  throw new Error('expected the call to throw');
};

describe('coach.access', () => {
  describe('isCoachManager', () => {
    it.each([
      [Role.ADMIN, true],
      [Role.OWNER, true],
      [Role.COACH, false],
      [Role.MEMBER, false],
      ['STRANGER', false],
      [undefined, false],
    ])('%s -> %s', (role, expected) => {
      expect(isCoachManager(role)).toBe(expected);
    });
  });

  describe('getListAccess', () => {
    const query = { status: 'INACTIVE', coachType: 'FREELANCE' };

    it.each([Role.ADMIN, Role.OWNER])(
      '%s: both filters pass, name+email search, full view',
      (role) => {
        const access = getListAccess(role);

        expect(access.filtersOf(query)).toEqual({ status: 'INACTIVE', coachType: 'FREELANCE' });
        expect(access.searchFields).toEqual(['fullName', 'email']);
        expect(Object.keys(access.toView(row())).sort()).toContain('email');
      },
    );

    it.each([Role.COACH, Role.MEMBER, 'STRANGER', undefined])(
      '%s: ACTIVE forced, no type filter, name-only search, public view',
      (role) => {
        const access = getListAccess(role);

        expect(access.filtersOf(query)).toEqual({ status: CoachStatus.ACTIVE });
        expect(access.searchFields).toEqual(['fullName']);
        expect(Object.keys(access.toView(row())).sort()).toEqual([
          'bio',
          'fullName',
          'id',
          'profileImageUrl',
        ]);
      },
    );
  });

  describe('selectCoachView', () => {
    it.each([Role.ADMIN, Role.OWNER])('gives %s the full view', (role) => {
      expect(selectCoachView(caller(role), row())).toHaveProperty('email');
    });

    it('gives a coach the full view of their own profile', () => {
      expect(selectCoachView(own(), row())).toMatchObject({
        userId: 'user-1',
        phone: '+15551234567',
      });
    });

    it.each([
      ['a coach looking at another coach', caller(Role.COACH, 'user-2')],
      ['a member', caller(Role.MEMBER)],
    ])('gives %s the public view', (_label, who) => {
      const view = selectCoachView(who, row());

      expect(Object.keys(view).sort()).toEqual(['bio', 'fullName', 'id', 'profileImageUrl']);
    });
  });

  describe('assertCanSee', () => {
    it.each([Role.ADMIN, Role.OWNER])('%s sees an INACTIVE coach', (role) => {
      expect(() => assertCanSee(caller(role), inactive())).not.toThrow();
    });

    it('lets a coach see their own INACTIVE profile', () => {
      expect(() => assertCanSee(own(), inactive())).not.toThrow();
    });

    it.each([
      ['another coach', caller(Role.COACH, 'user-2')],
      ['a member', caller(Role.MEMBER)],
    ])('hides an INACTIVE coach from %s with a 404', (_label, who) => {
      expectCode(() => assertCanSee(who, inactive()), AppErrors.COACH_NOT_FOUND);
    });

    it.each([
      ['another coach', caller(Role.COACH, 'user-2')],
      ['a member', caller(Role.MEMBER)],
    ])('shows an ACTIVE coach to %s', (_label, who) => {
      expect(() => assertCanSee(who, row())).not.toThrow();
    });
  });

  describe('assertCanEdit', () => {
    it.each([Role.ADMIN, Role.OWNER])('lets %s edit any coach, also INACTIVE', (role) => {
      expect(() => assertCanEdit(caller(role), row())).not.toThrow();
      expect(() => assertCanEdit(caller(role), inactive())).not.toThrow();
    });

    it('lets a coach edit their own profile', () => {
      expect(() => assertCanEdit(own(), row())).not.toThrow();
    });

    it('answers 403 when a coach edits another ACTIVE coach', () => {
      expectCode(() => assertCanEdit(caller(Role.COACH, 'user-2'), row()), AppErrors.FORBIDDEN);
    });

    it('answers 404 when a coach edits another INACTIVE coach', () => {
      expectCode(
        () => assertCanEdit(caller(Role.COACH, 'user-2'), inactive()),
        AppErrors.COACH_NOT_FOUND,
      );
    });

    it.each([Role.MEMBER, 'STRANGER', undefined])(
      'answers 403 to %s, even on an own-id match',
      (role) => {
        expectCode(() => assertCanEdit({ id: 'user-1', role }, row()), AppErrors.FORBIDDEN);
      },
    );
  });

  describe('assertManager', () => {
    it.each([Role.ADMIN, Role.OWNER])('accepts %s', (role) => {
      expect(() => assertManager(caller(role))).not.toThrow();
    });

    it.each([Role.COACH, Role.MEMBER, 'STRANGER'])('answers 403 to %s', (role) => {
      expectCode(() => assertManager(caller(role)), AppErrors.FORBIDDEN);
    });
  });

  describe('editableFields', () => {
    it.each([Role.ADMIN, Role.OWNER])('%s may change all six fields', (role) => {
      expect(editableFields(role, ADMIN_COACH_UPDATE_FIELDS)).toEqual([
        ...ADMIN_COACH_UPDATE_FIELDS,
      ]);
    });

    it('caps a coach at the self-edit fields', () => {
      expect(editableFields(Role.COACH, ADMIN_COACH_UPDATE_FIELDS)).toEqual([
        ...COACH_SELF_UPDATE_FIELDS,
      ]);
      expect(editableFields(Role.COACH, ['email', 'coachType', 'status'])).toEqual([]);
    });

    it('never widens what the route offers', () => {
      expect(editableFields(Role.ADMIN, ['bio'])).toEqual(['bio']);
    });

    it.each([Role.MEMBER, 'STRANGER', undefined])('gives %s no fields', (role) => {
      expect(editableFields(role, ADMIN_COACH_UPDATE_FIELDS)).toEqual([]);
    });
  });
});
