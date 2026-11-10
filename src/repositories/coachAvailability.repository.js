const crypto = require('crypto');
const prisma = require('../config/prisma');
const { parseTimeTo1970Date } = require('./schedule.repository');

const WEEK_SELECT = {
  dayOfWeek: true,
  isAvailable: true,
  updatedAt: true,
  slots: {
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  },
};

// `client` is the prisma client or a transaction client, so callers can join their transaction.

// The saved day rows of one coach with their slots: two queries in total (days, then all their
// slots), whatever the number of days. Days that were never saved have no row.
const findWeekByCoachId = (coachId, client = prisma) =>
  client.coachAvailabilityDay.findMany({
    where: { coachId },
    select: WEEK_SELECT,
    orderBy: { dayOfWeek: 'asc' },
  });

// Serializes concurrent saves for one coach for the rest of the transaction, so two PUTs cannot
// interleave their delete + insert and collide on the (coachId, dayOfWeek) key.
const lockCoachAvailability = async (coachId, client = prisma) => {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coach_availability_' + coachId}))`;
};

// Replaces the whole week of one coach: removes every saved day (their slots go with them through
// ON DELETE CASCADE) and inserts the given days and slots with one statement each. Touches no
// other table. `days` is the validated body: [{ dayOfWeek, isAvailable, slots: [{ startTime, endTime }] }].
const replaceWeek = async (coachId, days, client = prisma, now = new Date()) => {
  await client.coachAvailabilityDay.deleteMany({ where: { coachId } });

  await client.coachAvailabilityDay.createMany({
    data: days.map(({ dayOfWeek, isAvailable }) => ({
      coachId,
      dayOfWeek,
      isAvailable,
      createdAt: now,
      updatedAt: now,
    })),
  });

  const slotRows = days.flatMap(({ dayOfWeek, slots }) =>
    slots.map(({ startTime, endTime }) => ({
      id: crypto.randomUUID(),
      coachId,
      dayOfWeek,
      startTime: parseTimeTo1970Date(startTime),
      endTime: parseTimeTo1970Date(endTime),
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (slotRows.length > 0) await client.coachAvailabilitySlot.createMany({ data: slotRows });
};

module.exports = { findWeekByCoachId, lockCoachAvailability, replaceWeek };
