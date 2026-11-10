const { HH_MM_REGEX, MINUTES_PER_DAY } = require('../constants/availability');
const { localDateTimeToUtc, addDaysToDateStr } = require('./timezone.util');

/**
 * Pure time-range helpers for coach availability (SLAPP 66/111).
 * A "range" is `{ start, end }` with numeric bounds (minutes since midnight for facility wall-clock
 * ranges, epoch milliseconds for UTC instants). Ranges are half-open, [start, end): a range that
 * ends where another starts does NOT overlap it. No Prisma, no env, no domain imports.
 */

// 'HH:mm' (24h) -> minutes since midnight, or null when it is not a valid HH:mm.
const parseHHmm = (value) => {
  if (typeof value !== 'string' || !HH_MM_REGEX.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const isValidHHmm = (value) => parseHHmm(value) !== null;

// Minutes since midnight -> 'HH:mm'. Throws on a value outside 0..1439 (a programming error).
const formatHHmm = (totalMinutes) => {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Minutes out of range: ${totalMinutes}`);
  }
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// { startTime: 'HH:mm', endTime: 'HH:mm' } -> { start, end } minutes, or null if either is invalid.
const toMinuteRange = ({ startTime, endTime }) => {
  const start = parseHHmm(startTime);
  const end = parseHHmm(endTime);
  if (start === null || end === null) return null;
  return { start, end };
};

// A valid range has a positive length.
const isValidRange = (range) => Boolean(range) && range.start < range.end;

// Half-open overlap: [0,60) and [60,120) do not overlap.
const rangesOverlap = (a, b) => a.start < b.end && b.start < a.end;

// `inner` lies completely inside `outer` (touching the outer bounds is fine).
const rangeContains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;

// The first pair of overlapping ranges as [i, j] indexes into the input (i's range starts first),
// or null. O(n log n): sort by start; if any range overlaps a later one, it also overlaps the one
// that follows it in start order, so only neighbours need comparing.
const findOverlappingPair = (ranges) => {
  const order = ranges.map((range, index) => ({ range, index }));
  order.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  for (let i = 1; i < order.length; i += 1) {
    if (order[i].range.start < order[i - 1].range.end) {
      return [order[i - 1].index, order[i].index];
    }
  }
  return null;
};

// Sorted copy where overlapping or touching ranges are merged. Lets a caller treat 09:00-12:00 plus
// 12:00-15:00 as one 09:00-15:00 window when checking whether an interval fits.
const mergeRanges = (ranges) => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
};

// Inclusive facility-local dates 'YYYY-MM-DD' -> the UTC instants that bound them: [start, end) with
// start = 00:00 of startDate and end = 00:00 of the day AFTER endDate, both in `timeZone`. Reuses
// localDateTimeToUtc, so DST and offsets are handled the same way as session generation.
const facilityDateRangeToUtc = (startDate, endDate, timeZone) => {
  const start = localDateTimeToUtc(startDate, '00:00', timeZone);
  const end = localDateTimeToUtc(addDaysToDateStr(endDate, 1), '00:00', timeZone);
  return { start, end };
};

// One facility-local date -> its UTC [start, end) day window.
const facilityDayToUtc = (dateStr, timeZone) => facilityDateRangeToUtc(dateStr, dateStr, timeZone);

module.exports = {
  parseHHmm,
  isValidHHmm,
  formatHHmm,
  toMinuteRange,
  isValidRange,
  rangesOverlap,
  rangeContains,
  findOverlappingPair,
  mergeRanges,
  facilityDateRangeToUtc,
  facilityDayToUtc,
};
