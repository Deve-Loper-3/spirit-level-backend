const prisma = require('../config/prisma');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

// Serializes every write that decides whether ONE coach is free (appointments today; manual session
// assignment later), for the rest of the transaction. Two requests for the same coach cannot both
// pass the conflict check and then both insert.
const lockCoachSchedule = async (coachId, client = prisma) => {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coach_schedule_' + coachId}))`;
};

const findCoachStatus = (coachId, client = prisma) =>
  client.coach.findUnique({ where: { id: coachId }, select: { id: true, status: true } });

module.exports = { lockCoachSchedule, findCoachStatus };
