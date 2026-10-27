const crypto = require('crypto');
const prisma = require('../config/prisma');
const { replaceSlotCoaches } = require('./class.repository');

const parseTimeTo1970Date = (timeStr) => {
  if (!timeStr) return null;
  if (timeStr instanceof Date) return timeStr;
  const parts = String(timeStr).split(':');
  const hh = parts[0].padStart(2, '0');
  const mm = (parts[1] || '00').padStart(2, '0');
  return new Date(`1970-01-01T${hh}:${mm}:00.000Z`);
};

const parseDateOnly = (dateStr) => {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const dStr = String(dateStr).substring(0, 10);
  return new Date(`${dStr}T00:00:00.000Z`);
};

const acquireClassAdvisoryLock = async (classId, client = prisma) => {
  if (!classId) return;
  // Hashes the class key into an advisory lock int64, scoped to current transaction
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'class_schedule_' + classId}))`;
};

const SLOT_INCLUDE = Object.freeze({
  coaches: {
    include: {
      coach: {
        include: {
          user: {
            select: { fullName: true, profileImageUrl: true },
          },
        },
      },
    },
  },
  class: {
    select: {
      id: true,
      name: true,
      status: true,
      visibility: true,
      durationMin: true,
      baseCapacity: true,
      timezone: true,
      coaches: {
        select: { coachId: true },
      },
    },
  },
});

const SESSION_INCLUDE = Object.freeze({
  coaches: {
    include: {
      coach: {
        include: {
          user: {
            select: { fullName: true, profileImageUrl: true },
          },
        },
      },
    },
  },
  class: {
    select: {
      id: true,
      name: true,
      status: true,
      visibility: true,
      durationMin: true,
      baseCapacity: true,
      intensity: true,
      classType: true,
      colour: true,
      photoUrl: true,
      timezone: true,
      description: true,
      coaches: {
        select: { coachId: true },
      },
    },
  },
  slot: {
    select: {
      id: true,
      active: true,
      dayOfWeek: true,
    },
  },
});

// Slot Repository Operations
const findSlotById = async (id, client = prisma) => {
  if (!id) return null;
  return client.classSlot.findUnique({
    where: { id },
    include: SLOT_INCLUDE,
  });
};

const findSlotsByClassId = async (classId, { includeInactive = false } = {}, client = prisma) => {
  const where = { classId };
  if (!includeInactive) {
    where.active = true;
  }
  return client.classSlot.findMany({
    where,
    include: SLOT_INCLUDE,
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
};

const findActiveSlotConflict = async (classId, dayOfWeek, startTime, excludeId = null, client = prisma) => {
  const parsedTime = parseTimeTo1970Date(startTime);
  const where = {
    classId,
    dayOfWeek,
    startTime: parsedTime,
    active: true,
  };
  if (excludeId) {
    where.id = { not: excludeId };
  }
  return client.classSlot.findFirst({
    where,
    include: SLOT_INCLUDE,
  });
};

const createSlotWithCoaches = async ({ classId, dayOfWeek, startDate, startTime, endTime, capacity, coachIds = [] }, client = prisma) => {
  const id = crypto.randomUUID();
  const dedupedCoaches = Array.from(new Set(coachIds));
  const coachesCreate = dedupedCoaches.map((coachId) => ({ coachId }));

  return client.classSlot.create({
    data: {
      id,
      classId,
      dayOfWeek,
      startDate: parseDateOnly(startDate),
      startTime: parseTimeTo1970Date(startTime),
      endTime: parseTimeTo1970Date(endTime),
      capacity: capacity ?? null,
      active: true,
      coaches: coachesCreate.length > 0 ? { create: coachesCreate } : undefined,
    },
    include: SLOT_INCLUDE,
  });
};

const updateSlot = async (slotId, data, coachIds = null, client = prisma) => {
  const updateData = {};
  if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
  if (data.startDate !== undefined) updateData.startDate = parseDateOnly(data.startDate);
  if (data.startTime !== undefined) updateData.startTime = parseTimeTo1970Date(data.startTime);
  if (data.endTime !== undefined) updateData.endTime = parseTimeTo1970Date(data.endTime);
  if (data.capacity !== undefined) updateData.capacity = data.capacity;
  if (data.active !== undefined) updateData.active = data.active;

  await client.classSlot.update({
    where: { id: slotId },
    data: updateData,
  });

  if (coachIds !== null && Array.isArray(coachIds)) {
    await replaceSlotCoaches(slotId, coachIds, client);
  }

  return findSlotById(slotId, client);
};

const softDeactivateSlot = async (slotId, client = prisma) => {
  return client.classSlot.update({
    where: { id: slotId },
    data: { active: false },
  });
};

const findGeneratedFutureSessionsForSlot = async (slotId, afterDate, client = prisma) => {
  return client.classSession.findMany({
    where: {
      slotId,
      source: 'GENERATED',
      startAt: { gte: afterDate },
    },
    include: SESSION_INCLUDE,
    orderBy: { startAt: 'asc' },
  });
};

const deleteSessionsByIds = async (sessionIds, client = prisma) => {
  if (!sessionIds || sessionIds.length === 0) return { count: 0 };
  return client.classSession.deleteMany({
    where: { id: { in: sessionIds } },
  });
};

// Session Repository Operations
const findSessionById = async (id, client = prisma) => {
  if (!id) return null;
  return client.classSession.findUnique({
    where: { id },
    include: SESSION_INCLUDE,
  });
};

const findSessions = async ({ from, to, classId, coachId, state, isPrivate, page = 1, pageSize = 100 }, client = prisma) => {
  const where = {};

  if (from || to) {
    where.startAt = {};
    if (from) where.startAt.gte = from instanceof Date ? from : new Date(from);
    if (to) where.startAt.lte = to instanceof Date ? to : new Date(to);
  }

  if (classId) {
    where.classId = classId;
  }

  if (coachId) {
    where.coaches = {
      some: { coachId },
    };
  }

  if (state) {
    where.state = state.toUpperCase();
  }

  if (typeof isPrivate === 'boolean') {
    where.isPrivate = isPrivate;
  }

  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const [sessions, total] = await Promise.all([
    client.classSession.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: { startAt: 'asc' },
      skip,
      take,
    }),
    client.classSession.count({ where }),
  ]);

  return { sessions, total };
};

const findSessionAtStartTime = async (classId, startAt, excludeSessionId = null, client = prisma) => {
  const where = {
    classId,
    startAt: startAt instanceof Date ? startAt : new Date(startAt),
  };
  if (excludeSessionId) {
    where.id = { not: excludeSessionId };
  }
  return client.classSession.findFirst({
    where,
    include: SESSION_INCLUDE,
  });
};

/**
 * Checks for coach conflict across all classes.
 * Overlap predicate is half-open: [startAt, endAt)
 * session.startAt < newEndAt AND session.endAt > newStartAt
 * Cancelled sessions free up coach time and are excluded.
 */
const findCoachOverlappingSessions = async (coachId, startAt, endAt, excludeSessionId = null, client = prisma) => {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const end = endAt instanceof Date ? endAt : new Date(endAt);

  const where = {
    state: { not: 'CANCELLED' },
    startAt: { lt: end },
    endAt: { gt: start },
    coaches: {
      some: { coachId },
    },
  };

  if (excludeSessionId) {
    where.id = { not: excludeSessionId };
  }

  return client.classSession.findMany({
    where,
    include: SESSION_INCLUDE,
  });
};

const replaceSessionCoaches = async (sessionId, coachIds, client = prisma) => {
  await client.classSessionCoach.deleteMany({ where: { sessionId } });
  if (coachIds.length === 0) return;
  const deduped = Array.from(new Set(coachIds));
  await client.classSessionCoach.createMany({
    data: deduped.map((coachId) => ({ sessionId, coachId })),
  });
};

const createSession = async (sessionData, coachIds = [], client = prisma) => {
  const id = crypto.randomUUID();
  const dedupedCoaches = Array.from(new Set(coachIds));
  const coachesCreate = dedupedCoaches.map((coachId) => ({ coachId }));

  return client.classSession.create({
    data: {
      id,
      ...sessionData,
      coaches: coachesCreate.length > 0 ? { create: coachesCreate } : undefined,
    },
    include: SESSION_INCLUDE,
  });
};

const updateSession = async (sessionId, data, coachIds = null, client = prisma) => {
  const { expectedVersion, ...restData } = data;
  const where = { id: sessionId };
  if (typeof expectedVersion === 'number') {
    where.version = expectedVersion;
  }

  const updated = await client.classSession.updateMany({
    where,
    data: {
      ...restData,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    return null; // Signals version conflict or not found
  }

  if (coachIds !== null && Array.isArray(coachIds)) {
    await replaceSessionCoaches(sessionId, coachIds, client);
  }

  return findSessionById(sessionId, client);
};

const findCoachesByIdsWithDetails = async (coachIds, client = prisma) => {
  if (!coachIds || coachIds.length === 0) return [];
  return client.coach.findMany({
    where: { id: { in: coachIds } },
    include: {
      user: {
        select: { fullName: true, status: true },
      },
    },
  });
};

module.exports = {
  parseTimeTo1970Date,
  parseDateOnly,
  acquireClassAdvisoryLock,
  findSlotById,
  findSlotsByClassId,
  findActiveSlotConflict,
  createSlotWithCoaches,
  updateSlot,
  softDeactivateSlot,
  findGeneratedFutureSessionsForSlot,
  deleteSessionsByIds,
  findSessionById,
  findSessions,
  findSessionAtStartTime,
  findCoachOverlappingSessions,
  replaceSessionCoaches,
  createSession,
  updateSession,
  findCoachesByIdsWithDetails,
};
