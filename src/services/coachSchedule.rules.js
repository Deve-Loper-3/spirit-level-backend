const { CoachConflictType, ConflictItemKind } = require('../constants/coachConflict');
const { DAY_LABELS } = require('../constants/availability');
const { Messages } = require('../constants/messages');
const {
  getDateInTimezone,
  getIsoDayOfWeek,
  localDateTimeToUtc,
  addDaysToDateStr,
} = require('../utils/timezone.util');
const { facilityDateRangeToUtc } = require('../utils/timeRange.util');

// ==========================================
// Coach schedule rules (SLAPP 66/111 S7): PURE functions, no database, no env, no clock.
//
// Every rule answers "does this interval clash?" with a conflict or null:
//   { type, message, conflictingItem: { kind, id, startAt, endAt } | null }   (ISO 8601 UTC strings)
// `findFirstConflict` runs them in the approved order and the first failure wins:
//   availability -> leave -> class sessions -> appointments.
// Intervals are half-open [startAt, endAt): touching intervals do not overlap.
// ==========================================

const MS_PER_MINUTE = 60 * 1000;
const iso = (date) => date.toISOString();

const conflict = (type, message, conflictingItem = null) => ({ type, message, conflictingItem });

const item = (kind, id, startAt, endAt) => ({
  kind,
  id,
  startAt: iso(startAt),
  endAt: iso(endAt),
});

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const byStart = (a, b) => a.startAt - b.startAt || String(a.id).localeCompare(String(b.id));

// ---- Availability -------------------------------------------------------------------------

// Facility-local view of an interval: the weekday, and its start / end in minutes since local midnight
// of the START day (an end after midnight is > 1440, so it can never fit a slot, which ends by 23:59).
const toLocalInterval = (startAt, endAt, timezone) => {
  const date = getDateInTimezone(startAt, timezone);
  const midnight = localDateTimeToUtc(date, '00:00', timezone);
  const nextMidnight = localDateTimeToUtc(addDaysToDateStr(date, 1), '00:00', timezone);
  return {
    date,
    dayOfWeek: getIsoDayOfWeek(date),
    startMin: (startAt.getTime() - midnight.getTime()) / MS_PER_MINUTE,
    endMin: (endAt.getTime() - midnight.getTime()) / MS_PER_MINUTE,
    crossesMidnight: endAt.getTime() > nextMidnight.getTime(),
  };
};

const minutesToText = (minutes) => {
  const whole = Math.floor(minutes);
  const h = String(Math.floor(whole / 60)).padStart(2, '0');
  const m = String(whole % 60).padStart(2, '0');
  return `${h}:${m}`;
};

// Merges ranges that overlap or touch, so 09:00-12:00 + 12:00-15:00 behaves as 09:00-15:00.
// (A local copy of the same idea as timeRange.mergeRanges, working on plain {start,end} minutes.)
const mergeTouching = (ranges) => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
};

// `day` is the coach's saved row for that weekday: { isAvailable, ranges: [{ start, end }] } in minutes,
// or null / undefined when no row was saved.
//   - no row, or an available day without any range  -> AVAILABILITY_NOT_SET ("no hours saved")
//   - isAvailable = false (an explicit day off)       -> OUTSIDE_AVAILABILITY
//   - otherwise the interval must fit fully inside ONE (merged) range of that facility day.
const checkAvailability = ({ startAt, endAt, timezone, day }) => {
  const local = toLocalInterval(startAt, endAt, timezone);
  const label = DAY_LABELS[local.dayOfWeek];

  if (!day || (day.isAvailable && day.ranges.length === 0)) {
    return conflict(
      CoachConflictType.AVAILABILITY_NOT_SET,
      Messages.COACH_CONFLICT_AVAILABILITY_NOT_SET(label),
    );
  }
  if (!day.isAvailable) {
    return conflict(CoachConflictType.OUTSIDE_AVAILABILITY, Messages.COACH_CONFLICT_DAY_OFF(label));
  }
  if (local.crossesMidnight) {
    return conflict(
      CoachConflictType.OUTSIDE_AVAILABILITY,
      Messages.COACH_CONFLICT_CROSSES_MIDNIGHT(label),
    );
  }
  const fits = mergeTouching(day.ranges).some(
    (range) => range.start <= local.startMin && local.endMin <= range.end,
  );
  if (fits) return null;
  return conflict(
    CoachConflictType.OUTSIDE_AVAILABILITY,
    Messages.COACH_CONFLICT_OUTSIDE_AVAILABILITY(
      label,
      minutesToText(local.startMin),
      minutesToText(local.endMin),
    ),
  );
};

// ---- Leave --------------------------------------------------------------------------------

// `leaves`: [{ id, startDate, endDate }] with inclusive facility dates 'YYYY-MM-DD'. A leave blocks
// every instant of its days, so the interval clashes when it touches any of them.
const checkLeave = ({ startAt, endAt, timezone, leaves }) => {
  const windows = leaves
    .map((leave) => ({
      leave,
      ...facilityDateRangeToUtc(leave.startDate, leave.endDate, timezone),
    }))
    .filter((w) => overlaps(startAt, endAt, w.start, w.end))
    .sort((a, b) => a.start - b.start || String(a.leave.id).localeCompare(String(b.leave.id)));
  if (windows.length === 0) return null;
  const { leave, start, end } = windows[0];
  return conflict(
    CoachConflictType.COACH_UNAVAILABLE,
    Messages.COACH_CONFLICT_ON_LEAVE(leave.startDate, leave.endDate),
    item(ConflictItemKind.LEAVE, leave.id, start, end),
  );
};

// ---- Class sessions -----------------------------------------------------------------------

// `sessions`: NOT cancelled sessions of this coach [{ id, startAt, endAt }]. Raw time only: a session
// that ends exactly when the interval starts (or starts when it ends) is fine.
const checkSessions = ({ startAt, endAt, sessions }) => {
  const clash = sessions
    .filter((s) => overlaps(startAt, endAt, s.startAt, s.endAt))
    .sort(byStart)[0];
  if (!clash) return null;
  return conflict(
    CoachConflictType.SESSION_OVERLAP,
    Messages.COACH_CONFLICT_SESSION_OVERLAP,
    item(ConflictItemKind.SESSION, clash.id, clash.startAt, clash.endAt),
  );
};

// ---- Appointments -------------------------------------------------------------------------

const occupied = (startAt, endAt, bufferBeforeMin, bufferAfterMin) => ({
  start: startAt.getTime() - bufferBeforeMin * MS_PER_MINUTE,
  end: endAt.getTime() + bufferAfterMin * MS_PER_MINUTE,
});

// `appointments`: BOOKED appointments of this coach [{ id, startAt, endAt, bufferBeforeMin, bufferAfterMin }].
// Each one occupies [start - bufferBefore, end + bufferAfter]; so does the new interval with ITS buffers.
//   raw times overlap                      -> APPOINTMENT_OVERLAP (preferred when both apply)
//   only the buffered windows overlap      -> APPOINTMENT_BUFFER
const checkAppointments = ({
  startAt,
  endAt,
  bufferBeforeMin = 0,
  bufferAfterMin = 0,
  appointments,
}) => {
  const mine = occupied(startAt, endAt, bufferBeforeMin, bufferAfterMin);
  const sorted = [...appointments].sort(byStart);

  const raw = sorted.find((a) => overlaps(startAt, endAt, a.startAt, a.endAt));
  if (raw) {
    return conflict(
      CoachConflictType.APPOINTMENT_OVERLAP,
      Messages.COACH_CONFLICT_APPOINTMENT_OVERLAP,
      item(ConflictItemKind.APPOINTMENT, raw.id, raw.startAt, raw.endAt),
    );
  }
  const buffered = sorted.find((a) => {
    const theirs = occupied(a.startAt, a.endAt, a.bufferBeforeMin, a.bufferAfterMin);
    return overlaps(mine.start, mine.end, theirs.start, theirs.end);
  });
  if (!buffered) return null;
  return conflict(
    CoachConflictType.APPOINTMENT_BUFFER,
    Messages.COACH_CONFLICT_APPOINTMENT_BUFFER,
    item(ConflictItemKind.APPOINTMENT, buffered.id, buffered.startAt, buffered.endAt),
  );
};

// ---- Order of the rules -------------------------------------------------------------------

// First failing rule wins: availability, leave, sessions, appointments. Returns the conflict with the
// coach id added, or null when the coach is free.
const findFirstConflict = ({
  coachId,
  startAt,
  endAt,
  bufferBeforeMin = 0,
  bufferAfterMin = 0,
  timezone,
  day,
  leaves = [],
  sessions = [],
  appointments = [],
}) => {
  const found =
    checkAvailability({ startAt, endAt, timezone, day }) ||
    checkLeave({ startAt, endAt, timezone, leaves }) ||
    checkSessions({ startAt, endAt, sessions }) ||
    checkAppointments({ startAt, endAt, bufferBeforeMin, bufferAfterMin, appointments });
  return found ? { ...found, coachId } : null;
};

module.exports = {
  toLocalInterval,
  checkAvailability,
  checkLeave,
  checkSessions,
  checkAppointments,
  findFirstConflict,
};
