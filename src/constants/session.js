const SessionSource = Object.freeze({
  GENERATED: 'GENERATED',
  ONE_OFF: 'ONE_OFF',
});

const SESSION_ROLLING_WINDOW_DAYS = 21;
const SESSION_CAPACITY_MIN = 1;
const SESSION_CAPACITY_MAX = 200;

const SESSION_OVERRIDE_FIELDS = Object.freeze([
  'capacity',
  'durationMin',
  'coachIds',
  'startAt',
  'endAt',
  'intensity',
  'classType',
  'facility',
  'description',
  'image',
  'cancel',
]);

const SESSION_OVERRIDE_MANDATORY_REASON_FIELDS = Object.freeze([
  'coachIds',
  'startAt',
  'endAt',
  'cancel',
]);

module.exports = {
  SessionSource,
  SESSION_ROLLING_WINDOW_DAYS,
  SESSION_CAPACITY_MIN,
  SESSION_CAPACITY_MAX,
  SESSION_OVERRIDE_FIELDS,
  SESSION_OVERRIDE_MANDATORY_REASON_FIELDS,
};
