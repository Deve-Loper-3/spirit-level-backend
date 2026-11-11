const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { CoachStatus } = require('../constants/coach');
const repo = require('../repositories/coachSchedule.repository');
const typeRepo = require('../repositories/appointmentType.repository');
const { findCoachById } = require('../repositories/coach.repository');
const { assertCanViewAvailability } = require('./coach.access');
const { buildOpenSlots } = require('./coachSlots.rules');
const { facilityDateRangeToUtc } = require('../utils/timeRange.util');
const { addDaysToDateStr } = require('../utils/timezone.util');

const eachDate = (from, to) => {
  const dates = [];
  for (let date = from; date <= to; date = addDaysToDateStr(date, 1)) dates.push(date);
  return dates;
};

// Free start times for one appointment type over a date range. Read only. The data comes from ONE query
// per source for the whole range (weekly hours, leave, class sessions, appointments), then the pure
// calculator cuts the slots; nothing is queried per day or per slot. Order of the answers: unknown coach
// 404, someone else's coach 403, unknown type 404, inactive coach / type 409.
// A slot is a suggestion: booking it re-checks everything under the coach's lock.
const getOpenSlots = async ({ caller, coachId, query, now = new Date() }) => {
  const coach = await findCoachById(coachId);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  assertCanViewAvailability(caller, coach);

  const type = await typeRepo.findAppointmentTypeById(query.appointmentTypeId);
  if (!type) throw createAppError(AppErrors.APPOINTMENT_TYPE_NOT_FOUND);
  if (coach.status !== CoachStatus.ACTIVE) throw createAppError(AppErrors.COACH_INACTIVE);
  if (!type.isActive) throw createAppError(AppErrors.APPOINTMENT_TYPE_INACTIVE);

  const timezone = env.FACILITY_TIMEZONE;
  const { from, to } = query;
  const window = facilityDateRangeToUtc(from, to, timezone);
  const coachIds = [coachId];

  const [weekRows, leaves, sessions, appointments] = await Promise.all([
    repo.findWeekForCoach(coachId),
    repo.findLeaveForCoaches(coachIds, from, to),
    repo.findSessionsForCoaches({ coachIds, startAt: window.start, endAt: window.end }),
    repo.findAppointmentsForCoaches({
      coachIds,
      startAt: window.start,
      endAt: window.end,
      bufferBeforeMin: type.bufferBeforeMin,
      bufferAfterMin: type.bufferAfterMin,
      excludeAppointmentId: query.excludeAppointmentId,
    }),
  ]);

  const days = buildOpenSlots({
    coachId,
    dates: eachDate(from, to),
    timezone,
    durationMin: type.durationMin,
    bufferBeforeMin: type.bufferBeforeMin,
    bufferAfterMin: type.bufferAfterMin,
    now,
    week: new Map(weekRows.map((row) => [row.dayOfWeek, row])),
    leaves,
    sessions,
    appointments,
  });

  return {
    coachId,
    appointmentTypeId: type.id,
    timezone,
    from,
    to,
    availabilityConfigured: weekRows.length > 0,
    days: days.map(({ date, slots }) => ({
      date,
      slots: slots.map((slot) => ({
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      })),
    })),
  };
};

module.exports = { getOpenSlots, eachDate };
