const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

// Sessions are removed first: class_sessions.classId is RESTRICT. Slots, class_coaches and
// class_slot_coaches go with the class (cascade); session coaches go with their session.
const deleteTestClasses = async (prefix, client = prisma) => {
  const where = { name: { startsWith: prefix, mode: 'insensitive' } };
  // Bookings RESTRICT their session; the credit ledger references the bookings, so it goes first.
  await client.memberCreditTransaction.deleteMany({
    where: { booking: { session: { class: where } } },
  });
  await client.classBooking.deleteMany({ where: { session: { class: where } } });
  await client.classSession.deleteMany({ where: { class: where } });
  return client.class.deleteMany({ where });
};

// A valid public class in the database; `overrides` change any column. The name always starts
// with `prefix`, so deleteTestClasses removes it.
const createTestClass = (prefix, overrides = {}, client = prisma) => {
  const { active, ...restOverrides } = overrides;
  let status = restOverrides.status || 'ACTIVE';
  if (active === false && !restOverrides.status) {
    status = 'DEACTIVATED';
  } else if (active === true && !restOverrides.status) {
    status = 'ACTIVE';
  }

  return client.class.create({
    data: {
      id: crypto.randomUUID(),
      name: `${prefix}${crypto.randomUUID()}`,
      durationMin: 60,
      baseCapacity: 12,
      classType: 'ONSITE',
      intensity: 3,
      classPassEnabled: false,
      classpassSpots: 0,
      visibility: 'PUBLIC',
      status,
      ...restOverrides,
    },
  });
};

const createTestSlot = (classId, overrides = {}, client = prisma) => {
  return client.classSlot.create({
    data: {
      id: crypto.randomUUID(),
      classId,
      dayOfWeek: 1,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      startTime: new Date(Date.UTC(1970, 0, 1, 6, 30)),
      endTime: new Date(Date.UTC(1970, 0, 1, 7, 30)),
      ...overrides,
    },
  });
};

// A one-off session one hour long, starting at `startAt`.
const createTestSession = (classId, overrides = {}, client = prisma) => {
  const startAt = overrides.startAt || new Date('2030-01-01T06:30:00.000Z');
  return client.classSession.create({
    data: {
      id: crypto.randomUUID(),
      classId,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      ...overrides,
    },
  });
};

const linkTestClassPlan = (classId, planId, client = prisma) =>
  client.classEligiblePlan.create({ data: { classId, planId } });

const linkTestClassCoach = (classId, coachId, client = prisma) =>
  client.classCoach.create({ data: { classId, coachId } });

module.exports = {
  deleteTestClasses,
  createTestClass,
  createTestSlot,
  createTestSession,
  linkTestClassPlan,
  linkTestClassCoach,
};
