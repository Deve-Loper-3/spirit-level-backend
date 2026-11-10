const { DAY_OF_WEEK_MIN, DAY_OF_WEEK_MAX } = require('../constants/availability');
const { formatTimeHHMM } = require('./schedule.mapper');

const toSlotResponse = (slot) => ({
  startTime: formatTimeHHMM(slot.startTime),
  endTime: formatTimeHHMM(slot.endTime),
});

// The saved rows of one coach -> the API view, always 7 days in dayOfWeek order 1..7.
// - A weekday with no saved row is `{ isAvailable: false, slots: [] }`.
// - `isConfigured` is false only when no hours were ever saved (clients show "hours not set").
// - `updatedAt` is the time of the last save (ISO 8601 UTC), explicit null if never saved. A save
//   replaces the whole week in one transaction, so all rows share one timestamp.
const toWeeklyAvailabilityResponse = ({ coachId, rows, timezone }) => {
  const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));

  const days = [];
  for (let dayOfWeek = DAY_OF_WEEK_MIN; dayOfWeek <= DAY_OF_WEEK_MAX; dayOfWeek += 1) {
    const row = byDay.get(dayOfWeek);
    days.push({
      dayOfWeek,
      isAvailable: row ? row.isAvailable : false,
      slots: row ? row.slots.map(toSlotResponse) : [],
    });
  }

  const lastSaved = rows.reduce((latest, row) => Math.max(latest, row.updatedAt.getTime()), 0);

  return {
    coachId,
    timezone,
    isConfigured: rows.length > 0,
    updatedAt: rows.length > 0 ? new Date(lastSaved).toISOString() : null,
    days,
  };
};

module.exports = { toWeeklyAvailabilityResponse };
