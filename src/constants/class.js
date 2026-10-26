const ClassVisibility = Object.freeze({
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
});

const SessionState = Object.freeze({
  OPEN: 'OPEN',
  FULL: 'FULL',
  CANCELLED: 'CANCELLED',
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

module.exports = {
  ClassVisibility,
  SessionState,
  INTENSITY_MIN,
  INTENSITY_MAX,
  DAY_OF_WEEK,
};
