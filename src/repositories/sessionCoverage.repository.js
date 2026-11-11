const prisma = require('../config/prisma');
const { SessionState } = require('../constants/class');

// `client` is the prisma client or a transaction client. Read only.

const dateOnly = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const toDateString = (date) => date.toISOString().slice(0, 10);

// ALL leave (every coach) that touches [fromDate, toDate] (inclusive 'YYYY-MM-DD'): ONE query. It serves
// both "who is unavailable" and "is anyone else free". Returns [{ id, coachId, startDate, endDate, reason }]
// with date strings.
const findLeaveInRange = async ({ fromDate, toDate }, client = prisma) => {
  const rows = await client.coachUnavailability.findMany({
    where: { startDate: { lte: dateOnly(toDate) }, endDate: { gte: dateOnly(fromDate) } },
    select: { id: true, coachId: true, startDate: true, endDate: true, reason: true },
  });
  return rows.map((row) => ({
    id: row.id,
    coachId: row.coachId,
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
    reason: row.reason,
  }));
};

// Not-cancelled sessions starting in [from, to) that have at least one of `coachIds` assigned, each with
// its class name and ALL assigned coaches (id + name): ONE query, no query per session.
const findSessionsWithCoaches = ({ coachIds, from, to, classId }, client = prisma) =>
  client.classSession.findMany({
    where: {
      state: { not: SessionState.CANCELLED },
      startAt: { gte: from, lt: to },
      coaches: { some: { coachId: { in: coachIds } } },
      ...(classId && { classId }),
    },
    select: {
      id: true,
      classId: true,
      startAt: true,
      endAt: true,
      class: { select: { name: true } },
      coaches: {
        select: { coachId: true, coach: { select: { user: { select: { fullName: true } } } } },
      },
    },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
  });

module.exports = { findLeaveInRange, findSessionsWithCoaches };
