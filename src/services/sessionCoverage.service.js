const env = require('../config/env');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Role } = require('../constants/roles');
const { isCoachManager } = require('./coach.access');
const repo = require('../repositories/sessionCoverage.repository');
const { findCoachByUserId } = require('../repositories/coach.repository');
const { computeCoverage } = require('./coachUnavailability.service');
const { SessionCoverage } = require('../constants/availability');
const { facilityDateRangeToUtc } = require('../utils/timeRange.util');
const { getDateInTimezone } = require('../utils/timezone.util');
const { buildPagination } = require('../utils/pagination.util');

const leaveCoversDay = (leave, day) => leave.startDate <= day && day <= leave.endDate;

// ==========================================
// Rules (pure, so they are unit tested without a database)
// ==========================================

// For one session: the assigned coaches that are on leave on the session's facility day (with the leave
// that covers it) and the assigned coaches that are not. `leavesByCoach`: Map coachId -> [leave].
const splitCoaches = ({ session, leavesByCoach, timezone }) => {
  const day = getDateInTimezone(session.startAt, timezone);
  const unavailable = [];
  const covering = [];
  session.coaches.forEach((assignment) => {
    const fullName = assignment.coach?.user?.fullName ?? null;
    const leave = (leavesByCoach.get(assignment.coachId) ?? []).find((l) => leaveCoversDay(l, day));
    if (leave) {
      unavailable.push({
        coachId: assignment.coachId,
        fullName,
        leave: {
          id: leave.id,
          startDate: leave.startDate,
          endDate: leave.endDate,
          reason: leave.reason,
        },
      });
    } else {
      covering.push({ coachId: assignment.coachId, fullName });
    }
  });
  return { unavailable, covering };
};

const groupLeave = (rows) => {
  const byCoach = new Map();
  rows.forEach((row) => {
    const list = byCoach.get(row.coachId) ?? [];
    list.push(row);
    byCoach.set(row.coachId, list);
  });
  return byCoach;
};

// One coverage entry, or null when no assigned coach is on leave that day (or, with `onlyCoachId`, when
// that coach is not one of them). `coverage` is the S4 definition (computeCoverage): COVERED when at
// least one assigned coach is NOT on leave that day, so there is no second copy of the rule.
const toCoverageEntry = ({ session, leavesByCoach, timezone, onlyCoachId }) => {
  const { unavailable, covering } = splitCoaches({ session, leavesByCoach, timezone });
  if (unavailable.length === 0) return null;
  if (onlyCoachId && !unavailable.some((u) => u.coachId === onlyCoachId)) return null;
  const leaveRanges = new Map(
    [...leavesByCoach].map(([id, list]) => [
      id,
      list.map((l) => ({ startDate: l.startDate, endDate: l.endDate })),
    ]),
  );
  const coverage = computeCoverage({
    session,
    coachId: unavailable[0].coachId,
    leaveByCoach: leaveRanges,
    timezone,
  });
  return {
    sessionId: session.id,
    classId: session.classId,
    title: session.class.name,
    startAt: session.startAt.toISOString(),
    endAt: session.endAt.toISOString(),
    unavailableCoaches: unavailable,
    coverage,
    coveringCoaches: coverage === SessionCoverage.COVERED ? covering : [],
  };
};

// Managers see every session; a coach only the sessions where THEY are the unavailable coach (a
// `coachId` of someone else is 403, and a coach without a profile is 403); other roles are 403.
const resolveCoachFilter = async (caller, requestedCoachId) => {
  if (isCoachManager(caller.role)) return requestedCoachId;
  if (caller.role !== Role.COACH) throw createAppError(AppErrors.FORBIDDEN);
  const coach = await findCoachByUserId(caller.id);
  if (!coach) throw createAppError(AppErrors.FORBIDDEN);
  if (requestedCoachId && requestedCoachId !== coach.id) throw createAppError(AppErrors.FORBIDDEN);
  return coach.id;
};

// Upcoming class sessions in a date range that have an assigned coach on leave that day, with who is
// unavailable, who covers and whether the session is COVERED or UNCOVERED. Read only: it changes no
// session, booking or leave. Cost: two queries (all leave in the range, then the sessions of the coaches
// on leave) whatever the number of sessions; filtering and paging happen in memory because "has a coach on
// leave that day" cannot be paged in SQL. `coachId` = sessions where that coach is on leave.
const listSessionCoverage = async ({ caller, query }) => {
  const onlyCoachId = await resolveCoachFilter(caller, query.coachId);
  const { from, to, classId, page, limit } = query;
  const timezone = env.FACILITY_TIMEZONE;
  const window = facilityDateRangeToUtc(from, to, timezone);

  const leaveRows = await repo.findLeaveInRange({ fromDate: from, toDate: to });
  const leavesByCoach = groupLeave(leaveRows);
  const coachIdsOnLeave = onlyCoachId
    ? [onlyCoachId].filter((id) => leavesByCoach.has(id))
    : [...leavesByCoach.keys()];
  if (coachIdsOnLeave.length === 0) {
    return { data: [], pagination: buildPagination({ page, limit, total: 0 }) };
  }

  const sessions = await repo.findSessionsWithCoaches({
    coachIds: coachIdsOnLeave,
    from: window.start,
    to: window.end,
    classId,
  });
  const entries = sessions
    .map((session) => toCoverageEntry({ session, leavesByCoach, timezone, onlyCoachId }))
    .filter(Boolean);

  const offset = (page - 1) * limit;
  return {
    data: entries.slice(offset, offset + limit),
    pagination: buildPagination({ page, limit, total: entries.length }),
  };
};

module.exports = { listSessionCoverage, toCoverageEntry, splitCoaches, resolveCoachFilter };
