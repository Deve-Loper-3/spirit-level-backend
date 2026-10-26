const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

// Sessions are removed first: class_sessions.classId is RESTRICT. Slots, class_coaches and
// class_slot_coaches go with the class (cascade); session coaches go with their session.
const deleteTestClasses = async (prefix, client = prisma) => {
  const where = { name: { startsWith: prefix, mode: 'insensitive' } };
  await client.classSession.deleteMany({ where: { class: where } });
  return client.class.deleteMany({ where });
};

// A valid public class in the database; `overrides` change any column. The name always starts
// with `prefix`, so deleteTestClasses removes it.
const createTestClass = (prefix, overrides = {}, client = prisma) => {
  return client.class.create({
    data: {
      id: crypto.randomUUID(),
      name: `${prefix}${crypto.randomUUID()}`,
      durationMin: 60,
      baseCapacity: 12,
      visibility: 'PUBLIC',
      ...overrides,
    },
  });
};

const createTestSlot = (classId, overrides = {}, client = prisma) => {
  return client.classSlot.create({
    data: {
      id: crypto.randomUUID(),
      classId,
      dayOfWeek: 1,
      startTime: new Date(Date.UTC(1970, 0, 1, 6, 30)),
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

module.exports = { deleteTestClasses, createTestClass, createTestSlot, createTestSession };
