const prisma = require('../config/prisma');
const { SessionState } = require('../constants/class');
const { AppointmentState } = require('../constants/appointment');
const { CoachStatus } = require('../constants/coach');
const { MAX_STORED_BUFFER_MIN } = require('../constants/coachConflict');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

// Serializes every write that decides whether ONE coach is free (appointments today; manual session
// assignment later), for the rest of the transaction. Two requests for the same coach cannot both
// pass the conflict check and then both insert.
const lockCoachSchedule = async (coachId, client = prisma) => {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coach_schedule_' + coachId}))`;
};

const findCoachStatus = (coachId, client = prisma) =>
  client.coach.findUnique({ where: { id: coachId }, select: { id: true, status: true } });

// ---- Batch loaders for the conflict engine: ONE query per source for ALL the coaches ----------

const MS_PER_MINUTE = 60 * 1000;

// 'HH:mm:ss' TIME column (read as a 1970 Date) -> minutes since midnight.
const timeToMinutes = (date) => date.getUTCHours() * 60 + date.getUTCMinutes();

const dateOnly = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const toDateString = (date) => date.toISOString().slice(0, 10);

// The saved row of ONE weekday for every given coach (a coach with no row is simply absent).
// Returns [{ coachId, isAvailable, ranges: [{ start, end }] }].
const findDaysForCoaches = async (coachIds, dayOfWeek, client = prisma) => {
  const rows = await client.coachAvailabilityDay.findMany({
    where: { coachId: { in: coachIds }, dayOfWeek },
    select: {
      coachId: true,
      isAvailable: true,
      slots: { select: { startTime: true, endTime: true }, orderBy: { startTime: 'asc' } },
    },
  });
  return rows.map((row) => ({
    coachId: row.coachId,
    isAvailable: row.isAvailable,
    ranges: row.slots.map((slot) => ({
      start: timeToMinutes(slot.startTime),
      end: timeToMinutes(slot.endTime),
    })),
  }));
};

// The whole saved week of ONE coach (every weekday row, with its slots as minutes). A coach whose week
// was never saved returns []. Two Prisma queries at most (days, nested slots), whatever the number of days.
const findWeekForCoach = async (coachId, client = prisma) => {
  const rows = await client.coachAvailabilityDay.findMany({
    where: { coachId },
    select: {
      dayOfWeek: true,
      isAvailable: true,
      slots: { select: { startTime: true, endTime: true }, orderBy: { startTime: 'asc' } },
    },
  });
  return rows.map((row) => ({
    dayOfWeek: row.dayOfWeek,
    isAvailable: row.isAvailable,
    ranges: row.slots.map((slot) => ({
      start: timeToMinutes(slot.startTime),
      end: timeToMinutes(slot.endTime),
    })),
  }));
};

// Leave of the given coaches that touches [firstDate, lastDate] (inclusive 'YYYY-MM-DD').
// Returns [{ id, coachId, startDate, endDate }] with date strings.
const findLeaveForCoaches = async (coachIds, firstDate, lastDate, client = prisma) => {
  const rows = await client.coachUnavailability.findMany({
    where: {
      coachId: { in: coachIds },
      startDate: { lte: dateOnly(lastDate) },
      endDate: { gte: dateOnly(firstDate) },
    },
    select: { id: true, coachId: true, startDate: true, endDate: true },
  });
  return rows.map((row) => ({
    id: row.id,
    coachId: row.coachId,
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
  }));
};

// Not-cancelled class sessions that overlap [startAt, endAt) and have at least one of the coaches
// assigned. Returns [{ id, startAt, endAt, coachIds: [only the requested coaches on that session] }].
const findSessionsForCoaches = async (
  { coachIds, startAt, endAt, excludeSessionId },
  client = prisma,
) => {
  const rows = await client.classSession.findMany({
    where: {
      state: { not: SessionState.CANCELLED },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      coaches: { some: { coachId: { in: coachIds } } },
      ...(excludeSessionId && { id: { not: excludeSessionId } }),
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      coaches: { where: { coachId: { in: coachIds } }, select: { coachId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    startAt: row.startAt,
    endAt: row.endAt,
    coachIds: row.coaches.map((c) => c.coachId),
  }));
};

// BOOKED appointments of the coaches whose buffered window can reach the interval. The window is
// widened by the largest buffer that can be stored (plus the new item's own buffers), the exact test
// is done by the rules. Uses the partial index on (coachId, startAt, endAt) WHERE state = 'BOOKED'.
const findAppointmentsForCoaches = async (
  { coachIds, startAt, endAt, bufferBeforeMin = 0, bufferAfterMin = 0, excludeAppointmentId },
  client = prisma,
) =>
  client.appointment.findMany({
    where: {
      coachId: { in: coachIds },
      state: AppointmentState.BOOKED,
      startAt: {
        lt: new Date(endAt.getTime() + (bufferAfterMin + MAX_STORED_BUFFER_MIN) * MS_PER_MINUTE),
      },
      endAt: {
        gt: new Date(startAt.getTime() - (bufferBeforeMin + MAX_STORED_BUFFER_MIN) * MS_PER_MINUTE),
      },
      ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
    },
    select: {
      id: true,
      coachId: true,
      startAt: true,
      endAt: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
    },
  });

// ACTIVE coaches for the coach picker, by name.
const findActiveCoachesForPicker = (client = prisma) =>
  client.coach.findMany({
    where: { status: CoachStatus.ACTIVE },
    select: { id: true, user: { select: { fullName: true } } },
    orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
  });

module.exports = {
  lockCoachSchedule,
  findCoachStatus,
  findDaysForCoaches,
  findWeekForCoach,
  findLeaveForCoaches,
  findSessionsForCoaches,
  findAppointmentsForCoaches,
  findActiveCoachesForPicker,
};
