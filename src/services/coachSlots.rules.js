const { findFirstConflict, mergeTouching } = require('./coachSchedule.rules');
const { localDateTimeToUtc, getIsoDayOfWeek } = require('../utils/timezone.util');

// ==========================================
// Open appointment slots (SLAPP 66/111 S8): PURE, no database, env or clock (`now` is a parameter).
//
// For each facility day: take the coach's saved ranges (touching ones merged), cut out what is in the
// way (class sessions on raw time, appointments with THEIR buffers widened by the new appointment's own
// buffers), cut every free gap into candidates of `durationMin` (step = duration), drop candidates that
// do not start in the future, and finally run every candidate through the S7 rules
// (`findFirstConflict`), so a slot is returned exactly when booking it would be accepted. Leave blocks
// the whole day. Times are Dates (UTC instants); a day is the facility-local day of `date`.
// ==========================================

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const leaveCoversDate = (leaves, date) =>
  leaves.some((leave) => leave.startDate <= date && date <= leave.endDate);

// Free parts of [rangeStart, rangeEnd) after cutting out `blockers` ([{ start, end }] in ms).
const subtractBlockers = (rangeStart, rangeEnd, blockers) => {
  const gaps = [];
  let cursor = rangeStart;
  const sorted = [...blockers].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const blocker of sorted) {
    if (blocker.end <= cursor) continue;
    if (blocker.start >= rangeEnd) break;
    if (blocker.start > cursor)
      gaps.push({ start: cursor, end: Math.min(blocker.start, rangeEnd) });
    cursor = Math.max(cursor, blocker.end);
  }
  if (cursor < rangeEnd) gaps.push({ start: cursor, end: rangeEnd });
  return gaps;
};

// Candidates of `durationMs` from the start of a gap, back to back; a remainder shorter than the
// duration is dropped.
const cutGap = (gap, durationMs) => {
  const slots = [];
  for (let start = gap.start; start + durationMs <= gap.end; start += durationMs) {
    slots.push({ start, end: start + durationMs });
  }
  return slots;
};

const slotsForDate = ({
  coachId,
  date,
  timezone,
  durationMin,
  bufferBeforeMin,
  bufferAfterMin,
  now,
  day,
  leaves,
  sessions,
  appointments,
}) => {
  if (!day || !day.isAvailable || day.ranges.length === 0) return [];
  if (leaveCoversDate(leaves, date)) return [];

  const midnight = localDateTimeToUtc(date, '00:00', timezone).getTime();
  const dayEnd = midnight + MS_PER_DAY;
  const durationMs = durationMin * MS_PER_MINUTE;

  // Only what can reach this day. An appointment blocks from (its start - its before-buffer - the new
  // after-buffer) to (its end + its after-buffer + the new before-buffer): the new slot's buffered
  // footprint must not touch the existing buffered footprint.
  const daySessions = sessions.filter(
    (s) => s.startAt.getTime() < dayEnd && s.endAt.getTime() > midnight,
  );
  const appointmentBlock = (a) => ({
    start: a.startAt.getTime() - (a.bufferBeforeMin + bufferAfterMin) * MS_PER_MINUTE,
    end: a.endAt.getTime() + (a.bufferAfterMin + bufferBeforeMin) * MS_PER_MINUTE,
  });
  const dayAppointments = appointments.filter((a) => {
    const block = appointmentBlock(a);
    return block.start < dayEnd && block.end > midnight;
  });

  const blockers = [
    ...daySessions.map((s) => ({ start: s.startAt.getTime(), end: s.endAt.getTime() })),
    ...dayAppointments.map(appointmentBlock),
  ];

  const ranges = mergeTouching(day.ranges).map((range) => ({
    start: midnight + range.start * MS_PER_MINUTE,
    end: midnight + range.end * MS_PER_MINUTE,
  }));

  return ranges
    .flatMap((range) => subtractBlockers(range.start, range.end, blockers))
    .flatMap((gap) => cutGap(gap, durationMs))
    .filter((slot) => slot.start > now.getTime())
    .map((slot) => ({ startAt: new Date(slot.start), endAt: new Date(slot.end) }))
    .filter(
      (slot) =>
        findFirstConflict({
          coachId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          bufferBeforeMin,
          bufferAfterMin,
          timezone,
          day,
          leaves,
          sessions: daySessions,
          appointments: dayAppointments,
        }) === null,
    );
};

// `dates`: facility days 'YYYY-MM-DD', in order. `week`: Map ISO weekday -> { isAvailable, ranges:
// [{ start, end }] minutes } (a weekday without a saved row is absent). `leaves`: [{ id, startDate,
// endDate }]. `sessions`: [{ id, startAt, endAt }] not cancelled. `appointments`: BOOKED
// [{ id, startAt, endAt, bufferBeforeMin, bufferAfterMin }].
// Returns [{ date, slots: [{ startAt: Date, endAt: Date }] }], one entry per date (empty slots allowed).
const buildOpenSlots = ({
  coachId,
  dates,
  timezone,
  durationMin,
  bufferBeforeMin = 0,
  bufferAfterMin = 0,
  now,
  week,
  leaves = [],
  sessions = [],
  appointments = [],
}) =>
  dates.map((date) => ({
    date,
    slots: slotsForDate({
      coachId,
      date,
      timezone,
      durationMin,
      bufferBeforeMin,
      bufferAfterMin,
      now,
      day: week.get(getIsoDayOfWeek(date)) ?? null,
      leaves,
      sessions,
      appointments,
    }),
  }));

module.exports = { buildOpenSlots, subtractBlockers, cutGap };
