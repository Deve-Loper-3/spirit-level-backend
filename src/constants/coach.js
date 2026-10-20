const { AccountStatus } = require('./status');
const { Role } = require('./roles');

const CoachType = Object.freeze({
  SALARIED: 'SALARIED',
  FREELANCE: 'FREELANCE',
});

const CoachStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const COACH_BIO_MAX_LENGTH = 1000;

// An inactive coach cannot log in: the linked user account follows the coach status.
const UserStatusByCoachStatus = Object.freeze({
  [CoachStatus.ACTIVE]: AccountStatus.ACTIVE,
  [CoachStatus.INACTIVE]: AccountStatus.DISABLED,
});

// Only the matching `from` status changes. A PENDING user is never touched, so deactivating
// and reactivating a coach cannot skip the registration step.
const UserStatusTransitionByCoachStatus = Object.freeze({
  [CoachStatus.ACTIVE]: Object.freeze({
    from: AccountStatus.DISABLED,
    to: UserStatusByCoachStatus[CoachStatus.ACTIVE],
  }),
  [CoachStatus.INACTIVE]: Object.freeze({
    from: AccountStatus.ACTIVE,
    to: UserStatusByCoachStatus[CoachStatus.INACTIVE],
  }),
});

// Fields of a coach update. The first group is stored on the linked user, the second on the coach.
const COACH_USER_FIELDS = Object.freeze(['fullName', 'email', 'phone', 'profileImageUrl']);
const COACH_PROFILE_FIELDS = Object.freeze(['bio', 'coachType']);
const ADMIN_COACH_UPDATE_FIELDS = Object.freeze([...COACH_USER_FIELDS, ...COACH_PROFILE_FIELDS]);
// A coach edits their own profile but never their email, coachType or status.
const COACH_SELF_UPDATE_FIELDS = Object.freeze(['fullName', 'phone', 'profileImageUrl', 'bio']);

// Managers see and change everything; coaches and members only read (a coach also edits themself).
const COACH_MANAGER_ROLES = Object.freeze([Role.ADMIN, Role.OWNER]);
const COACH_READER_ROLES = Object.freeze([Role.ADMIN, Role.OWNER, Role.COACH, Role.MEMBER]);

// Which fields each role may change. A Map so an unlisted role has no entry and is denied.
const UPDATE_FIELDS_BY_ROLE = new Map([
  [Role.ADMIN, ADMIN_COACH_UPDATE_FIELDS],
  [Role.OWNER, ADMIN_COACH_UPDATE_FIELDS],
  [Role.COACH, COACH_SELF_UPDATE_FIELDS],
]);

module.exports = {
  CoachType,
  CoachStatus,
  COACH_BIO_MAX_LENGTH,
  UserStatusByCoachStatus,
  UserStatusTransitionByCoachStatus,
  COACH_USER_FIELDS,
  COACH_PROFILE_FIELDS,
  ADMIN_COACH_UPDATE_FIELDS,
  COACH_SELF_UPDATE_FIELDS,
  COACH_MANAGER_ROLES,
  COACH_READER_ROLES,
  UPDATE_FIELDS_BY_ROLE,
};
