const ClassVisibility = Object.freeze({
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
});

const ClassStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  ARCHIVED: 'ARCHIVED',
});

const ClassType = Object.freeze({
  ONSITE: 'ONSITE',
  ONLINE: 'ONLINE',
});

const SessionState = Object.freeze({
  OPEN: 'OPEN',
  FULL: 'FULL',
  CANCELLED: 'CANCELLED',
});

// Frozen constants for allowed session override keys (per requirement 2)
const SessionOverriddenField = Object.freeze({
  CAPACITY: 'capacity',
  DURATION: 'duration',
  COACHES: 'coaches',
  START_AT: 'startAt',
});

const INTENSITY_MIN = 1;
const INTENSITY_MAX = 5;

// ISO weekday numbers stored in class_slots.dayOfWeek (Monday = 1).
const DAY_OF_WEEK = Object.freeze({
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
});

const CLASS_NAME_MIN_LENGTH = 2;
const CLASS_NAME_MAX_LENGTH = 80;
const CLASS_DESCRIPTION_MAX_LENGTH = 1000;
const CLASS_DURATION_MIN = 15;
const CLASS_DURATION_MAX = 240;
const CLASS_BASE_CAPACITY_MIN = 1;
const CLASS_BASE_CAPACITY_MAX = 200;
const CLASS_CLASSPASS_SPOTS_MIN = 0;
const CLASS_COLOUR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const CLASS_PHOTO_URL_MAX_LENGTH = 2048;
const CLASS_DEFAULT_PAGE_SIZE = 100;
const CLASS_MAX_PAGE_SIZE = 100;

const CLASS_EDITABLE_FIELDS = Object.freeze([
  'name',
  'description',
  'durationMin',
  'classType',
  'baseCapacity',
  'intensity',
  'visibility',
  'classPassEnabled',
  'classpassSpots',
  'colour',
  'photoUrl',
  'coachIds',
]);

const CLASS_NON_EDITABLE_FIELDS = Object.freeze([
  'id',
  'active',
  'status',
  'externalRef',
  'version',
  'createdAt',
  'updatedAt',
  'eligiblePlanIds',
]);

module.exports = {
  ClassVisibility,
  ClassStatus,
  ClassType,
  SessionState,
  SessionOverriddenField,
  INTENSITY_MIN,
  INTENSITY_MAX,
  DAY_OF_WEEK,
  CLASS_NAME_MIN_LENGTH,
  CLASS_NAME_MAX_LENGTH,
  CLASS_DESCRIPTION_MAX_LENGTH,
  CLASS_DURATION_MIN,
  CLASS_DURATION_MAX,
  CLASS_BASE_CAPACITY_MIN,
  CLASS_BASE_CAPACITY_MAX,
  CLASS_CLASSPASS_SPOTS_MIN,
  CLASS_COLOUR_REGEX,
  CLASS_PHOTO_URL_MAX_LENGTH,
  CLASS_DEFAULT_PAGE_SIZE,
  CLASS_MAX_PAGE_SIZE,
  CLASS_EDITABLE_FIELDS,
  CLASS_NON_EDITABLE_FIELDS,
};
