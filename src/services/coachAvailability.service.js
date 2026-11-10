const prisma = require('../config/prisma');
const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { AuditAction } = require('../constants/audit');
const { DAY_LABELS } = require('../constants/availability');
const { findCoachById } = require('../repositories/coach.repository');
const {
  findWeekByCoachId,
  lockCoachAvailability,
  replaceWeek,
} = require('../repositories/coachAvailability.repository');
const { toWeeklyAvailabilityResponse } = require('../repositories/coachAvailability.mapper');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { assertCanViewAvailability, assertManager } = require('./coach.access');
const { toMinuteRange, isValidRange, findOverlappingPair } = require('../utils/timeRange.util');

// Delete + two inserts + audit + read back is several round trips on the remote database.
const TX_OPTIONS = Object.freeze({ maxWait: 15000, timeout: 30000 });

const requireCoach = async (coachId) => {
  const coach = await findCoachById(coachId);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  return coach;
};

const toView = (coachId, rows) =>
  toWeeklyAvailabilityResponse({ coachId, rows, timezone: env.FACILITY_TIMEZONE });

const slotText = ({ startTime, endTime }) => `${startTime}-${endTime}`;

const validationError = (field, message) =>
  createAppError(AppErrors.VALIDATION_ERROR.statusCode, message, AppErrors.VALIDATION_ERROR.code, [
    { field, message },
  ]);

// The slots of one day must not overlap (touching slots, 09:00-12:00 and 12:00-15:00, are fine).
// This is checked here, in the service, and never left to the database. The 400 names the day and
// both slots, and points `errors[].field` at the later slot. A slot whose end is not after its
// start is rejected too, so a bad range never reaches the database CHECK.
const assertNoOverlappingSlots = (days) => {
  days.forEach((day, dayIndex) => {
    const slots = day.slots ?? [];
    const ranges = slots.map(toMinuteRange);

    const badIndex = ranges.findIndex((range) => !isValidRange(range));
    if (badIndex >= 0) {
      throw validationError(
        `days.${dayIndex}.slots.${badIndex}.endTime`,
        Messages.SLOT_END_BEFORE_START,
      );
    }

    const pair = findOverlappingPair(ranges);
    if (pair) {
      const [first, second] = pair;
      throw validationError(
        `days.${dayIndex}.slots.${Math.max(first, second)}.startTime`,
        Messages.AVAILABILITY_SLOTS_OVERLAP_DETAIL(
          DAY_LABELS[day.dayOfWeek],
          slotText(slots[first]),
          slotText(slots[second]),
        ),
      );
    }
  });
};

// Short before/after figures for the audit row. Not a dump of the week.
const summarizeRows = (rows) => ({
  configured: rows.length > 0,
  availableDays: rows.filter((row) => row.isAvailable).length,
  slotCount: rows.reduce((total, row) => total + row.slots.length, 0),
});

const summarizeDays = (days) => ({
  configured: true,
  availableDays: days.filter((day) => day.isAvailable).length,
  slotCount: days.reduce((total, day) => total + day.slots.length, 0),
});

// A manager reads any coach; a coach reads only their own (403 for another coach). Unknown coach: 404.
const getWeeklyAvailability = async ({ caller, coachId }) => {
  const coach = await requireCoach(coachId);
  assertCanViewAvailability(caller, coach);
  return toView(coachId, await findWeekByCoachId(coachId));
};

// Managers only (a coach gets 403 before anything is read). Replaces the whole week in ONE
// transaction together with its audit row, and writes to no other table: class templates, slots,
// sessions and bookings are not touched, so existing commitments stay as they are.
const saveWeeklyAvailability = async ({ actor, coachId, days, meta }) => {
  assertManager(actor);
  const coach = await requireCoach(coachId);
  assertNoOverlappingSlots(days);

  const rows = await prisma.$transaction(async (tx) => {
    await lockCoachAvailability(coachId, tx);
    const before = summarizeRows(await findWeekByCoachId(coachId, tx));

    await replaceWeek(coachId, days, tx);

    await createAuditLog(tx, {
      userId: coach.user.id,
      action: AuditAction.COACH_AVAILABILITY_UPDATED,
      email: coach.user.email,
      actorId: actor.id,
      actorRole: actor.role,
      details: { coachId, before, after: summarizeDays(days) },
      meta,
    });

    return findWeekByCoachId(coachId, tx);
  }, TX_OPTIONS);

  return toView(coachId, rows);
};

module.exports = { getWeeklyAvailability, saveWeeklyAvailability, assertNoOverlappingSlots };
