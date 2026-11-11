const { DAY_OF_WEEK } = require('./class');

// SLAPP 66/111: coach weekly availability and date-specific unavailability (leave).
// Days are ISO weekdays (Monday = 1 ... Sunday = 7), the same codes as class slots.
const DAY_OF_WEEK_MIN = DAY_OF_WEEK.MONDAY;
const DAY_OF_WEEK_MAX = DAY_OF_WEEK.SUNDAY;
// Saving weekly hours replaces the whole week, so a request carries exactly one entry per weekday.
const DAYS_PER_WEEK = DAY_OF_WEEK_MAX - DAY_OF_WEEK_MIN + 1;

// Times are 24h HH:mm facility wall-clock (FACILITY_TIMEZONE). 24:00 is not valid and a range
// cannot cross midnight (end must be later than start on the same day).
const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;

// Day names for messages (ISO weekday -> label).
const DAY_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(DAY_OF_WEEK).map(([name, number]) => [
      number,
      name.charAt(0) + name.slice(1).toLowerCase(),
    ]),
  ),
);

const MAX_SLOTS_PER_DAY = 10;

const UNAVAILABILITY_REASON_MAX_LENGTH = 200;
const UNAVAILABILITY_NOTE_MAX_LENGTH = 1000;

// POST / PATCH of a leave list the class sessions it touches, at most this many (the rest is
// reported in `affectedTotal`).
const AFFECTED_SESSIONS_CAP = 100;

// Is another assigned coach free on the day? (API enum strings.)
const SessionCoverage = Object.freeze({
  COVERED: 'COVERED',
  UNCOVERED: 'UNCOVERED',
});

module.exports = {
  DAY_OF_WEEK,
  DAY_OF_WEEK_MIN,
  DAY_OF_WEEK_MAX,
  DAYS_PER_WEEK,
  DAY_LABELS,
  HH_MM_REGEX,
  MINUTES_PER_DAY,
  MAX_SLOTS_PER_DAY,
  UNAVAILABILITY_REASON_MAX_LENGTH,
  UNAVAILABILITY_NOTE_MAX_LENGTH,
  AFFECTED_SESSIONS_CAP,
  SessionCoverage,
};
