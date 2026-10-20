// Who may see and change which coach data. Every rule that depends on the caller's role lives here,
// so the service stays free of role checks. Managers (ADMIN, OWNER) see everything; a coach sees
// their own profile in full; everyone else sees ACTIVE coaches in the public view.
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { CoachStatus, COACH_MANAGER_ROLES, UPDATE_FIELDS_BY_ROLE } = require('../constants/coach');
const { toCoachResponse, toPublicCoachResponse } = require('../repositories/coach.mapper');

const toFullView = (row) => toCoachResponse(row.user, row);
const toPublicView = (row) => toPublicCoachResponse(row.user, row);

const isCoachManager = (role) => COACH_MANAGER_ROLES.includes(role);

const isOwnProfile = (caller, coach) => coach.user.id === caller.id;

// Managers may filter by status and type and search by name or email. Everyone else gets ACTIVE
// coaches only, no type filter and a name-only search, so an email can never be probed.
const MANAGER_LIST_ACCESS = Object.freeze({
  toView: toFullView,
  filtersOf: ({ status, coachType }) => ({ status, coachType }),
  searchFields: Object.freeze(['fullName', 'email']),
});

const PUBLIC_LIST_ACCESS = Object.freeze({
  toView: toPublicView,
  filtersOf: () => ({ status: CoachStatus.ACTIVE }),
  searchFields: Object.freeze(['fullName']),
});

const getListAccess = (role) => (isCoachManager(role) ? MANAGER_LIST_ACCESS : PUBLIC_LIST_ACCESS);

const isVisibleTo = (caller, coach) =>
  isCoachManager(caller.role) || isOwnProfile(caller, coach) || coach.status === CoachStatus.ACTIVE;

const selectCoachView = (caller, coach) =>
  isCoachManager(caller.role) || isOwnProfile(caller, coach)
    ? toFullView(coach)
    : toPublicView(coach);

// A coach that the caller cannot see is reported as missing, never as forbidden.
const assertCanSee = (caller, coach) => {
  if (!isVisibleTo(caller, coach)) throw createAppError(AppErrors.COACH_NOT_FOUND);
};

// A role without edit fields (a member, an unknown role) never edits. Managers edit any coach.
// A coach only edits their own profile; another coach they could see is a 403, one they could
// not see is a 404.
const assertCanEdit = (caller, coach) => {
  if (!UPDATE_FIELDS_BY_ROLE.has(caller.role)) throw createAppError(AppErrors.FORBIDDEN);
  if (isCoachManager(caller.role)) return;
  assertCanSee(caller, coach);
  if (!isOwnProfile(caller, coach)) throw createAppError(AppErrors.FORBIDDEN);
};

// Status changes are for managers only.
const assertManager = (caller) => {
  if (!isCoachManager(caller.role)) throw createAppError(AppErrors.FORBIDDEN);
};

// The route already limits the fields; this cap keeps a wrong route from widening them.
const editableFields = (role, requestedFields) => {
  const permitted = UPDATE_FIELDS_BY_ROLE.get(role) ?? [];
  return requestedFields.filter((field) => permitted.includes(field));
};

module.exports = {
  isCoachManager,
  getListAccess,
  selectCoachView,
  toFullView,
  assertCanSee,
  assertCanEdit,
  assertManager,
  editableFields,
};
