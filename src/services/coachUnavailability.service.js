const prisma = require('../config/prisma');
const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { AuditAction } = require('../constants/audit');
const { AFFECTED_SESSIONS_CAP, SessionCoverage } = require('../constants/availability');
const { findCoachById } = require('../repositories/coach.repository');
const repo = require('../repositories/coachUnavailability.repository');
const {
  toDateString,
  toUnavailabilityResponse,
  toAffectedSessionResponse,
  toUnavailabilityWithImpact,
} = require('../repositories/coachUnavailability.mapper');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { assertCanViewAvailability, assertManager } = require('./coach.access');
const { getTodayInTimezone, getDateInTimezone } = require('../utils/timezone.util');
const { facilityDateRangeToUtc } = require('../utils/timeRange.util');
const { buildPagination } = require('../utils/pagination.util');

// Lock + overlap check + write + audit is several round trips on the remote database.
const TX_OPTIONS = Object.freeze({ maxWait: 15000, timeout: 30000 });

const requireCoach = async (coachId) => {
  const coach = await findCoachById(coachId);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  return coach;
};

const validationError = (field, message) =>
  createAppError(AppErrors.VALIDATION_ERROR.statusCode, message, AppErrors.VALIDATION_ERROR.code, [
    { field, message },
  ]);

// Today in the facility timezone, as 'YYYY-MM-DD'. Leave dates are facility calendar dates.
const facilityToday = () => getTodayInTimezone(env.FACILITY_TIMEZONE);

// ==========================================
// Date rules (pure, so they are unit tested without a database)
// ==========================================

const assertEndNotBeforeStart = (startDate, endDate) => {
  if (endDate < startDate) {
    throw validationError('endDate', Messages.UNAVAILABILITY_END_BEFORE_START);
  }
};

// New leave: it may start today or later, never in the past.
const assertCreateDates = ({ startDate, endDate }, today) => {
  if (startDate < today) {
    throw validationError('startDate', Messages.UNAVAILABILITY_START_IN_PAST(today));
  }
  assertEndNotBeforeStart(startDate, endDate);
};

// Merges the stored leave with the patch and applies the edit rules. The checks run on the MERGED
// dates, so a patch with only `endDate` is still checked against the stored `startDate`.
//   - ended already (endDate < today): nothing can change (409 UNAVAILABILITY_PAST_IMMUTABLE);
//   - started already (startDate < today <= endDate): startDate is locked; endDate (extend or
//     shorten, but not into the past), reason and note can change;
//   - not started yet: every field can change, but a changed date cannot be in the past.
// A date that is sent but equal to the stored value is not a change.
const resolveUpdate = (stored, patch, today) => {
  const storedStart = toDateString(stored.startDate);
  const storedEnd = toDateString(stored.endDate);
  if (storedEnd < today) throw createAppError(AppErrors.UNAVAILABILITY_PAST_IMMUTABLE);

  const merged = {
    startDate: patch.startDate ?? storedStart,
    endDate: patch.endDate ?? storedEnd,
    reason: patch.reason ?? stored.reason,
    note: 'note' in patch ? patch.note : (stored.note ?? null),
  };

  if (merged.startDate !== storedStart) {
    if (storedStart < today)
      throw validationError('startDate', Messages.UNAVAILABILITY_START_LOCKED);
    if (merged.startDate < today) {
      throw validationError('startDate', Messages.UNAVAILABILITY_START_IN_PAST(today));
    }
  }
  if (merged.endDate !== storedEnd && merged.endDate < today) {
    throw validationError('endDate', Messages.UNAVAILABILITY_END_IN_PAST(today));
  }
  assertEndNotBeforeStart(merged.startDate, merged.endDate);
  return merged;
};

// Leave of the same coach that shares a date (inclusive) is a 409 that names the existing range.
// Checked in the service, inside the transaction that holds the coach's lock.
const assertNoOverlap = async ({ coachId, startDate, endDate, excludeId }, tx) => {
  const clash = await repo.findOverlappingUnavailability(
    { coachId, startDate, endDate, excludeId },
    tx,
  );
  if (!clash) return;
  const range = { startDate: toDateString(clash.startDate), endDate: toDateString(clash.endDate) };
  throw createAppError(
    AppErrors.UNAVAILABILITY_OVERLAP,
    Messages.UNAVAILABILITY_OVERLAP_DETAIL(range.startDate, range.endDate),
    undefined,
    { conflict: { id: clash.id, ...range } },
  );
};

// ==========================================
// Affected class sessions (read-only information)
// ==========================================

const isOnLeave = (leaveRanges, day) =>
  leaveRanges.some((range) => range.startDate <= day && day <= range.endDate);

// COVERED = at least one OTHER coach assigned to the session is not on leave on the session's
// facility-local day. A session with no other coach is UNCOVERED.
// `leaveByCoach`: Map coachId -> [{ startDate, endDate }] ('YYYY-MM-DD').
const computeCoverage = ({ session, coachId, leaveByCoach, timezone }) => {
  const day = getDateInTimezone(session.startAt, timezone);
  const covered = session.coaches
    .map((assignment) => assignment.coachId)
    .filter((id) => id !== coachId)
    .some((id) => !isOnLeave(leaveByCoach.get(id) ?? [], day));
  return covered ? SessionCoverage.COVERED : SessionCoverage.UNCOVERED;
};

const groupLeaveByCoach = (rows) => {
  const byCoach = new Map();
  rows.forEach((row) => {
    const ranges = byCoach.get(row.coachId) ?? [];
    ranges.push({ startDate: toDateString(row.startDate), endDate: toDateString(row.endDate) });
    byCoach.set(row.coachId, ranges);
  });
  return byCoach;
};

// The upcoming, not-cancelled class sessions inside the leave that this coach is assigned to, with
// their coverage. Three queries at most, whatever the number of sessions: the sessions (with class
// name and all assigned coaches), their count, and the other coaches' leave. Nothing is changed.
// A session that has already started is not "upcoming" and is left out.
const findAffectedSessions = async ({ coachId, startDate, endDate, now = new Date() }) => {
  const timezone = env.FACILITY_TIMEZONE;
  const window = facilityDateRangeToUtc(startDate, endDate, timezone);
  const from = window.start > now ? window.start : now;
  if (from >= window.end) return { affectedSessions: [], affectedTotal: 0 };

  const { rows, total } = await repo.findAssignedSessionsInWindow({
    coachId,
    from,
    to: window.end,
    take: AFFECTED_SESSIONS_CAP,
  });
  if (rows.length === 0) return { affectedSessions: [], affectedTotal: 0 };

  const otherCoachIds = [
    ...new Set(
      rows
        .flatMap((session) => session.coaches.map((a) => a.coachId))
        .filter((id) => id !== coachId),
    ),
  ];
  const leaveRows =
    otherCoachIds.length > 0
      ? await repo.findLeaveOfCoaches({ coachIds: otherCoachIds, startDate, endDate })
      : [];
  const leaveByCoach = groupLeaveByCoach(leaveRows);

  return {
    affectedSessions: rows.map((session) =>
      toAffectedSessionResponse(
        session,
        computeCoverage({ session, coachId, leaveByCoach, timezone }),
      ),
    ),
    affectedTotal: total,
  };
};

// ==========================================
// Use cases
// ==========================================

const range = ({ startDate, endDate }) => ({ startDate, endDate });

const toResponseDates = (row) => ({
  startDate: toDateString(row.startDate),
  endDate: toDateString(row.endDate),
});

// A manager reads any coach's leave; a coach reads only their own (403 for another coach).
const listUnavailability = async ({ caller, coachId, query }) => {
  const coach = await requireCoach(coachId);
  assertCanViewAvailability(caller, coach);
  const { page, limit, from, to } = query;
  const { rows, total } = await repo.listUnavailability({ coachId, from, to, page, limit });
  return {
    data: rows.map(toUnavailabilityResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

// Managers only. Adding leave changes no session or appointment; the response lists the sessions
// it touches so the caller can decide what to do about them.
const createUnavailability = async ({ actor, coachId, input, meta }) => {
  assertManager(actor);
  const coach = await requireCoach(coachId);
  assertCreateDates(input, facilityToday());

  const created = await prisma.$transaction(async (tx) => {
    await repo.lockCoachUnavailability(coachId, tx);
    await assertNoOverlap({ coachId, ...range(input) }, tx);
    const row = await repo.createUnavailability({ coachId, ...input }, tx);
    await createAuditLog(tx, {
      userId: coach.user.id,
      action: AuditAction.COACH_UNAVAILABILITY_CREATED,
      email: coach.user.email,
      actorId: actor.id,
      actorRole: actor.role,
      details: { coachId, unavailabilityId: row.id, ...range(input), reason: input.reason },
      meta,
    });
    return row;
  }, TX_OPTIONS);

  const impact = await findAffectedSessions({ coachId, ...range(input) });
  return toUnavailabilityWithImpact(created, impact);
};

const updateUnavailability = async ({ actor, coachId, unavailabilityId, patch, meta }) => {
  assertManager(actor);
  const coach = await requireCoach(coachId);
  const today = facilityToday();

  const updated = await prisma.$transaction(async (tx) => {
    await repo.lockCoachUnavailability(coachId, tx);
    const stored = await repo.findUnavailabilityById(coachId, unavailabilityId, tx);
    if (!stored) throw createAppError(AppErrors.UNAVAILABILITY_NOT_FOUND);

    const merged = resolveUpdate(stored, patch, today);
    await assertNoOverlap({ coachId, ...range(merged), excludeId: unavailabilityId }, tx);
    const row = await repo.updateUnavailability(unavailabilityId, merged, tx);

    await createAuditLog(tx, {
      userId: coach.user.id,
      action: AuditAction.COACH_UNAVAILABILITY_UPDATED,
      email: coach.user.email,
      actorId: actor.id,
      actorRole: actor.role,
      details: {
        coachId,
        unavailabilityId,
        before: {
          startDate: toDateString(stored.startDate),
          endDate: toDateString(stored.endDate),
        },
        after: range(merged),
        changed: Object.keys(patch),
      },
      meta,
    });
    return row;
  }, TX_OPTIONS);

  const impact = await findAffectedSessions({ coachId, ...range(toResponseDates(updated)) });
  return toUnavailabilityWithImpact(updated, impact);
};

// Past leave is history and stays; ongoing and future leave can be removed (it was added by
// mistake, or the coach is back early). Nothing else is touched.
const deleteUnavailability = async ({ actor, coachId, unavailabilityId, meta }) => {
  assertManager(actor);
  const coach = await requireCoach(coachId);
  const today = facilityToday();

  await prisma.$transaction(async (tx) => {
    await repo.lockCoachUnavailability(coachId, tx);
    const stored = await repo.findUnavailabilityById(coachId, unavailabilityId, tx);
    if (!stored) throw createAppError(AppErrors.UNAVAILABILITY_NOT_FOUND);
    if (toDateString(stored.endDate) < today) {
      throw createAppError(AppErrors.UNAVAILABILITY_PAST_IMMUTABLE);
    }

    await repo.deleteUnavailability(unavailabilityId, tx);
    await createAuditLog(tx, {
      userId: coach.user.id,
      action: AuditAction.COACH_UNAVAILABILITY_DELETED,
      email: coach.user.email,
      actorId: actor.id,
      actorRole: actor.role,
      details: { coachId, unavailabilityId, ...toResponseDates(stored) },
      meta,
    });
  }, TX_OPTIONS);

  return { id: unavailabilityId };
};

module.exports = {
  listUnavailability,
  createUnavailability,
  updateUnavailability,
  deleteUnavailability,
  assertCreateDates,
  resolveUpdate,
  computeCoverage,
  findAffectedSessions,
};
