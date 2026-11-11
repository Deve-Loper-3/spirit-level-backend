const crypto = require('crypto');
const prisma = require('../config/prisma');
const { SessionState } = require('../constants/class');
const { toSkipTake } = require('../utils/pagination.util');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

const UNAVAILABILITY_SELECT = {
  id: true,
  coachId: true,
  startDate: true,
  endDate: true,
  reason: true,
  note: true,
  createdAt: true,
  updatedAt: true,
};

// Leave dates are calendar dates (@db.Date): 'YYYY-MM-DD' <-> midnight UTC.
const toDateOnly = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);

// Two inclusive ranges share a date when each starts on or before the other ends.
const overlapsRange = (startDate, endDate) => ({
  startDate: { lte: toDateOnly(endDate) },
  endDate: { gte: toDateOnly(startDate) },
});

// The row is looked up by id AND coach, so another coach's row looks like a missing one.
const findUnavailabilityById = (coachId, id, client = prisma) =>
  client.coachUnavailability.findFirst({ where: { id, coachId }, select: UNAVAILABILITY_SELECT });

// One page of a coach's leave, sorted by start date (id breaks ties). `from` / `to` keep the leave
// that touches that window. Count and page run together (2 queries).
const listUnavailability = async ({ coachId, from, to, page, limit }, client = prisma) => {
  const where = {
    coachId,
    ...(to && { startDate: { lte: toDateOnly(to) } }),
    ...(from && { endDate: { gte: toDateOnly(from) } }),
  };
  const [rows, total] = await Promise.all([
    client.coachUnavailability.findMany({
      where,
      select: UNAVAILABILITY_SELECT,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      ...toSkipTake({ page, limit }),
    }),
    client.coachUnavailability.count({ where }),
  ]);
  return { rows, total };
};

// The earliest leave of this coach that shares a date with the range (the row being edited is left out).
const findOverlappingUnavailability = (
  { coachId, startDate, endDate, excludeId },
  client = prisma,
) =>
  client.coachUnavailability.findFirst({
    where: {
      coachId,
      ...(excludeId && { id: { not: excludeId } }),
      ...overlapsRange(startDate, endDate),
    },
    select: UNAVAILABILITY_SELECT,
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  });

// Serializes writes of one coach's leave for the rest of the transaction, so two requests cannot
// both pass the overlap check and then both insert.
const lockCoachUnavailability = async (coachId, client = prisma) => {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coach_unavailability_' + coachId}))`;
};

const createUnavailability = ({ coachId, startDate, endDate, reason, note }, client = prisma) =>
  client.coachUnavailability.create({
    data: {
      id: crypto.randomUUID(),
      coachId,
      startDate: toDateOnly(startDate),
      endDate: toDateOnly(endDate),
      reason,
      note,
    },
    select: UNAVAILABILITY_SELECT,
  });

const updateUnavailability = (id, { startDate, endDate, reason, note }, client = prisma) =>
  client.coachUnavailability.update({
    where: { id },
    data: {
      startDate: toDateOnly(startDate),
      endDate: toDateOnly(endDate),
      reason,
      note,
    },
    select: UNAVAILABILITY_SELECT,
  });

const deleteUnavailability = (id, client = prisma) =>
  client.coachUnavailability.delete({ where: { id } });

// ---- Read-only impact queries (what a leave touches; nothing here is ever written) ----

const AFFECTED_SESSION_SELECT = {
  id: true,
  classId: true,
  startAt: true,
  endAt: true,
  class: { select: { name: true } },
  coaches: { select: { coachId: true } },
};

// Not-cancelled sessions this coach is assigned to that start in [from, to). Total count plus the
// first `take` rows by start time, each with its class name and ALL its assigned coach ids (one
// join, so no query per session).
const findAssignedSessionsInWindow = async ({ coachId, from, to, take }, client = prisma) => {
  const where = {
    state: { not: SessionState.CANCELLED },
    startAt: { gte: from, lt: to },
    coaches: { some: { coachId } },
  };
  const [rows, total] = await Promise.all([
    client.classSession.findMany({
      where,
      select: AFFECTED_SESSION_SELECT,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take,
    }),
    client.classSession.count({ where }),
  ]);
  return { rows, total };
};

// Leave of several coaches that touches a date range: ONE query for all of them.
const findLeaveOfCoaches = ({ coachIds, startDate, endDate }, client = prisma) =>
  client.coachUnavailability.findMany({
    where: { coachId: { in: coachIds }, ...overlapsRange(startDate, endDate) },
    select: { coachId: true, startDate: true, endDate: true },
  });

module.exports = {
  findUnavailabilityById,
  listUnavailability,
  findOverlappingUnavailability,
  lockCoachUnavailability,
  createUnavailability,
  updateUnavailability,
  deleteUnavailability,
  findAssignedSessionsInWindow,
  findLeaveOfCoaches,
};
