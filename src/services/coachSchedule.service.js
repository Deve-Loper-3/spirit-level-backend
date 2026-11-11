const prisma = require('../config/prisma');
const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { CoachStatus } = require('../constants/coach');
const repo = require('../repositories/coachSchedule.repository');
const { findFirstConflict, toLocalInterval } = require('./coachSchedule.rules');
const { getDateInTimezone } = require('../utils/timezone.util');

// ==========================================
// Coach schedule conflict engine (SLAPP 66/111 S7)
//
// The rules themselves are pure (coachSchedule.rules.js). This file loads the data they need and
// applies them:
//   - checkCoachesForInterval: NON-throwing, many coaches at once. One query per source for all the
//     coaches (weekday row, leave, class sessions, appointments), never one per coach. Returns a
//     Map coachId -> conflict | null.
//   - assertIntervalAssignable: the throwing single-coach wrapper callers use inside a write.
//
// Contract (unchanged since S6):
//   - call it INSIDE a transaction that already holds `lockCoachSchedule(coachId, client)`;
//   - `client` is that transaction client;
//   - `startAt` / `endAt` are Dates (UTC instants), the buffers are minutes: the new item occupies
//     [startAt - bufferBeforeMin, endAt + bufferAfterMin] against appointments (class sessions block
//     raw time only);
//   - `excludeAppointmentId` / `excludeSessionId` leave that item out (reschedule, edit).
// First failing rule wins: availability -> leave -> class sessions -> appointments.
// ==========================================

const groupBy = (rows, keyOf) => {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyOf(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  });
  return groups;
};

const assertValidInterval = (startAt, endAt) => {
  if (!(startAt instanceof Date) || !(endAt instanceof Date) || !(startAt < endAt)) {
    throw new RangeError('startAt and endAt must be Dates with startAt before endAt');
  }
};

const checkCoachesForInterval = async (
  {
    coachIds,
    startAt,
    endAt,
    bufferBeforeMin = 0,
    bufferAfterMin = 0,
    excludeAppointmentId,
    excludeSessionId,
  },
  client = prisma,
) => {
  assertValidInterval(startAt, endAt);
  const ids = [...new Set(coachIds)];
  const result = new Map();
  if (ids.length === 0) return result;

  const timezone = env.FACILITY_TIMEZONE;
  const { dayOfWeek, date: firstDate } = toLocalInterval(startAt, endAt, timezone);
  const lastDate = getDateInTimezone(new Date(endAt.getTime() - 1), timezone);

  const [days, leaves, sessions, appointments] = await Promise.all([
    repo.findDaysForCoaches(ids, dayOfWeek, client),
    repo.findLeaveForCoaches(ids, firstDate, lastDate, client),
    repo.findSessionsForCoaches({ coachIds: ids, startAt, endAt, excludeSessionId }, client),
    repo.findAppointmentsForCoaches(
      { coachIds: ids, startAt, endAt, bufferBeforeMin, bufferAfterMin, excludeAppointmentId },
      client,
    ),
  ]);

  const dayByCoach = new Map(days.map((row) => [row.coachId, row]));
  const leaveByCoach = groupBy(leaves, (row) => row.coachId);
  const appointmentsByCoach = groupBy(appointments, (row) => row.coachId);
  // A session lists the requested coaches assigned to it, so it can belong to several coaches.
  const sessionsByCoach = new Map();
  sessions.forEach((session) => {
    session.coachIds.forEach((coachId) => {
      const list = sessionsByCoach.get(coachId) ?? [];
      list.push(session);
      sessionsByCoach.set(coachId, list);
    });
  });

  ids.forEach((coachId) => {
    result.set(
      coachId,
      findFirstConflict({
        coachId,
        startAt,
        endAt,
        bufferBeforeMin,
        bufferAfterMin,
        timezone,
        day: dayByCoach.get(coachId) ?? null,
        leaves: leaveByCoach.get(coachId) ?? [],
        sessions: sessionsByCoach.get(coachId) ?? [],
        appointments: appointmentsByCoach.get(coachId) ?? [],
      }),
    );
  });
  return result;
};

// Throws 404 COACH_NOT_FOUND / 409 COACH_INACTIVE for a coach that cannot be scheduled at all, then
// 409 COACH_CONFLICT with `details.conflicts: [{ type, coachId, message, conflictingItem }]` for the
// first rule the interval breaks (same envelope as the older session conflicts).
const assertIntervalAssignable = async (
  {
    coachId,
    startAt,
    endAt,
    bufferBeforeMin,
    bufferAfterMin,
    excludeAppointmentId,
    excludeSessionId,
  },
  client = prisma,
) => {
  const coach = await repo.findCoachStatus(coachId, client);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  if (coach.status !== CoachStatus.ACTIVE) throw createAppError(AppErrors.COACH_INACTIVE);

  const conflicts = await checkCoachesForInterval(
    {
      coachIds: [coachId],
      startAt,
      endAt,
      bufferBeforeMin,
      bufferAfterMin,
      excludeAppointmentId,
      excludeSessionId,
    },
    client,
  );
  const conflict = conflicts.get(coachId);
  if (!conflict) return;
  throw createAppError(AppErrors.COACH_CONFLICT, conflict.message, AppErrors.COACH_CONFLICT.code, {
    conflicts: [conflict],
  });
};

module.exports = { checkCoachesForInterval, assertIntervalAssignable };
