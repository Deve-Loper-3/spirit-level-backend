const crypto = require('crypto');
const prisma = require('../config/prisma');

const findByExternalRef = async (externalRef, client = prisma) => {
  if (!externalRef) return null;
  return client.class.findUnique({ where: { externalRef } });
};

const upsertByExternalRef = async ({ externalRef, data, client = prisma }) => {
  return client.class.upsert({
    where: { externalRef },
    update: data,
    create: { id: crypto.randomUUID(), externalRef, ...data },
  });
};

// class_slots.startTime is a Postgres TIME; Prisma reads and writes it as a UTC Date on 1970-01-01.
const upsertSlot = async ({ classId, dayOfWeek, startTime, capacity }, client = prisma) => {
  const where = { classId_dayOfWeek_startTime: { classId, dayOfWeek, startTime } };
  const existing = await client.classSlot.findUnique({ where });
  if (existing) {
    const slot = await client.classSlot.update({ where, data: { capacity } });
    return { slot, created: false };
  }
  const slot = await client.classSlot.create({
    data: { id: crypto.randomUUID(), classId, dayOfWeek, startTime, capacity },
  });
  return { slot, created: true };
};

const replaceClassCoaches = async (classId, coachIds, client = prisma) => {
  await client.classCoach.deleteMany({ where: { classId } });
  if (coachIds.length === 0) return;
  await client.classCoach.createMany({ data: coachIds.map((coachId) => ({ classId, coachId })) });
};

const replaceSlotCoaches = async (slotId, coachIds, client = prisma) => {
  await client.classSlotCoach.deleteMany({ where: { slotId } });
  if (coachIds.length === 0) return;
  await client.classSlotCoach.createMany({
    data: coachIds.map((coachId) => ({ slotId, coachId })),
  });
};

const listCoachesWithNames = async (client = prisma) => {
  const coaches = await client.coach.findMany({
    select: { id: true, user: { select: { fullName: true } } },
  });
  return coaches.map((coach) => ({ id: coach.id, fullName: coach.user.fullName }));
};

const listPublicClassesWithoutPlans = async (externalRefs, client = prisma) => {
  return client.class.findMany({
    where: {
      externalRef: { in: externalRefs },
      visibility: 'PUBLIC',
      active: true,
      eligiblePlans: { none: {} },
    },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
};

module.exports = {
  findByExternalRef,
  upsertByExternalRef,
  upsertSlot,
  replaceClassCoaches,
  replaceSlotCoaches,
  listCoachesWithNames,
  listPublicClassesWithoutPlans,
};
