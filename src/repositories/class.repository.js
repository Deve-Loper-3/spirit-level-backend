const crypto = require('crypto');
const prisma = require('../config/prisma');
const { createAppError, AppErrors } = require('../errors/AppError');
const { Messages } = require('../constants/messages');

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
      status: 'ACTIVE',
      eligiblePlans: { none: {} },
    },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
};

const CLASS_INCLUDE = Object.freeze({
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
  eligiblePlans: {
    select: { planId: true },
  },
  slots: {
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      capacity: true,
      active: true,
    },
  },
});

const CLASS_DETAIL_INCLUDE = Object.freeze({
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
  eligiblePlans: {
    select: {
      planId: true,
      plan: {
        select: { id: true, name: true },
      },
    },
  },
  slots: {
    include: {
      coaches: {
        include: {
          coach: {
            include: {
              user: {
                select: { fullName: true },
              },
            },
          },
        },
      },
    },
  },
  sessions: {
    where: {
      startAt: { gte: new Date() },
      state: { not: 'CANCELLED' },
    },
    orderBy: { startAt: 'asc' },
    take: 10,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      capacity: true,
      state: true,
    },
  },
});

const findById = async (id, options = {}, client = prisma) => {
  if (!id) return null;
  const include = options.isDetail ? CLASS_DETAIL_INCLUDE : CLASS_INCLUDE;
  return client.class.findUnique({
    where: { id },
    include,
  });
};

const findActiveByName = async (name, client = prisma) => {
  if (!name) return null;
  return client.class.findFirst({
    where: {
      name: { equals: name.trim(), mode: 'insensitive' },
      status: 'ACTIVE',
    },
  });
};

// Returns 0 until a bookings table exists; must mean sessions WITH bookings, never all future sessions.
const countFutureBookedSessions = async (_classId, _client = prisma) => 0;

const listClasses = async ({ where, page = 1, pageSize = 100 }, client = prisma) => {
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const [classes, total] = await Promise.all([
    client.class.findMany({
      where,
      include: CLASS_INCLUDE,
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    client.class.count({ where }),
  ]);

  return { classes, total };
};

const createClassWithPlans = async (
  { data, planIds = [], coachIds = [] },
  client = prisma,
) => {
  const id = crypto.randomUUID();
  const dedupedPlanIds = Array.from(new Set(planIds));
  const dedupedCoachIds = Array.from(new Set(coachIds));

  return client.$transaction(async (tx) => {
    const status = data.status || 'ACTIVE';
    await tx.class.create({
      data: {
        id,
        ...data,
        status,
      },
    });

    if (dedupedPlanIds.length > 0) {
      await tx.classEligiblePlan.createMany({
        data: dedupedPlanIds.map((planId) => ({ classId: id, planId })),
      });
    }

    if (dedupedCoachIds.length > 0) {
      await tx.classCoach.createMany({
        data: dedupedCoachIds.map((coachId) => ({ classId: id, coachId })),
      });
    }

    return tx.class.findUnique({
      where: { id },
      include: CLASS_INCLUDE,
    });
  });
};

const updateClass = async ({ id, data, coachIds, version }, client = prisma) => {
  return client.$transaction(async (tx) => {
    // If setting visibility to PUBLIC, lock row and ensure it has at least one eligible plan
    if (data.visibility === 'PUBLIC') {
      await tx.$executeRaw`SELECT id FROM classes WHERE id = ${id} FOR UPDATE`;
      const planCount = await tx.classEligiblePlan.count({ where: { classId: id } });
      if (planCount === 0) {
        throw createAppError(
          422,
          Messages.CLASS_PUBLIC_REQUIRES_PLANS,
          AppErrors.VALIDATION_ERROR.code,
          [{ field: 'visibility', message: Messages.CLASS_PUBLIC_REQUIRES_PLANS }],
        );
      }
    }

    if (coachIds !== undefined) {
      const dedupedCoachIds = Array.from(new Set(coachIds));
      await tx.classCoach.deleteMany({ where: { classId: id } });
      if (dedupedCoachIds.length > 0) {
        await tx.classCoach.createMany({
          data: dedupedCoachIds.map((coachId) => ({ classId: id, coachId })),
        });
      }
    }

    // Set-based SQL UPDATE for capacity propagation:
    // Updates future, non-cancelled sessions that have not overridden capacity
    if (data.baseCapacity !== undefined) {
      await tx.$executeRaw`
        UPDATE class_sessions
        SET capacity = ${data.baseCapacity}
        WHERE "classId" = ${id}
          AND "startAt" > NOW()
          AND "state" != 'CANCELLED'
          AND NOT ('capacity' = ANY("overriddenFields"))
      `;
    }

    // Set-based SQL UPDATE for duration propagation:
    // Updates future, non-cancelled sessions that have not overridden duration
    if (data.durationMin !== undefined) {
      await tx.$executeRaw`
        UPDATE class_sessions
        SET "endAt" = "startAt" + (${data.durationMin} * interval '1 minute')
        WHERE "classId" = ${id}
          AND "startAt" > NOW()
          AND "state" != 'CANCELLED'
          AND NOT ('duration' = ANY("overriddenFields"))
      `;
    }

    if (version !== undefined && version !== null) {
      const updateResult = await tx.class.updateMany({
        where: { id, version },
        data: {
          ...data,
          version: version + 1,
        },
      });

      if (updateResult.count === 0) {
        return { conflict: true };
      }

      const updated = await tx.class.findUnique({
        where: { id },
        include: CLASS_INCLUDE,
      });
      return { classRecord: updated };
    }

    const updated = await tx.class.update({
      where: { id },
      data: {
        ...data,
        version: { increment: 1 },
      },
      include: CLASS_INCLUDE,
    });
    return { classRecord: updated };
  });
};

const deactivateClass = async (id, client = prisma) => {
  const updated = await client.class.update({
    where: { id },
    data: { status: 'DEACTIVATED' },
    select: { id: true, status: true },
  });
  return { id: updated.id, status: 'deactivated', active: false };
};

const activateClass = async (id, client = prisma) => {
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id, name, status FROM classes WHERE id = ${id} FOR UPDATE`;
    const cls = rows && rows[0];
    if (!cls) return null;

    const existing = await tx.$queryRaw`
      SELECT id FROM classes
      WHERE LOWER(name) = LOWER(${cls.name})
        AND status = 'ACTIVE'
        AND id != ${id}
      LIMIT 1
    `;
    if (existing && existing.length > 0) {
      throw createAppError(AppErrors.CLASS_DUPLICATE_NAME);
    }

    const updated = await tx.class.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    return { id: updated.id, status: 'active', active: true };
  });
};

const archiveClass = async (id, client = prisma) => {
  const updated = await client.class.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    select: { id: true, status: true },
  });
  return { id: updated.id, status: 'archived', active: false };
};

const replaceEligiblePlans = async ({ classId, planIds }, client = prisma) => {
  const dedupedPlanIds = Array.from(new Set(planIds));

  return client.$transaction(async (tx) => {
    // Lock class row for update and check visibility
    const classes =
      await tx.$queryRaw`SELECT id, visibility FROM classes WHERE id = ${classId} FOR UPDATE`;
    const classRow = classes && classes[0];
    if (classRow && classRow.visibility === 'PUBLIC' && dedupedPlanIds.length === 0) {
      throw createAppError(
        422,
        Messages.CLASS_PUBLIC_REQUIRES_PLANS,
        AppErrors.VALIDATION_ERROR.code,
        [{ field: 'planIds', message: Messages.CLASS_PUBLIC_REQUIRES_PLANS }],
      );
    }

    await tx.classEligiblePlan.deleteMany({
      where: { classId },
    });

    if (dedupedPlanIds.length > 0) {
      await tx.classEligiblePlan.createMany({
        data: dedupedPlanIds.map((planId) => ({ classId, planId })),
      });
    }

    return dedupedPlanIds;
  });
};

const validatePlanIds = async (planIds, client = prisma) => {
  if (!planIds || planIds.length === 0) {
    return { valid: true, unknownIds: [], archivedIds: [] };
  }

  const plans = await client.membershipPlan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, status: true },
  });

  const foundIds = new Set(plans.map((p) => p.id));
  const unknownIds = planIds.filter((id) => !foundIds.has(id));
  const archivedIds = plans.filter((p) => p.status === 'ARCHIVED').map((p) => p.id);

  return {
    valid: unknownIds.length === 0 && archivedIds.length === 0,
    unknownIds,
    archivedIds,
  };
};

const validateCoachIds = async (coachIds, client = prisma) => {
  if (!coachIds || coachIds.length === 0) {
    return { valid: true, unknownIds: [] };
  }

  const coaches = await client.coach.findMany({
    where: { id: { in: coachIds } },
    select: { id: true },
  });

  const foundIds = new Set(coaches.map((c) => c.id));
  const unknownIds = coachIds.filter((id) => !foundIds.has(id));

  return {
    valid: unknownIds.length === 0,
    unknownIds,
  };
};

module.exports = {
  findByExternalRef,
  upsertByExternalRef,
  upsertSlot,
  replaceClassCoaches,
  replaceSlotCoaches,
  listCoachesWithNames,
  listPublicClassesWithoutPlans,
  findById,
  findActiveByName,
  countFutureBookedSessions,
  listClasses,
  createClassWithPlans,
  updateClass,
  deactivateClass,
  activateClass,
  archiveClass,
  replaceEligiblePlans,
  validatePlanIds,
  validateCoachIds,
  CLASS_INCLUDE,
  CLASS_DETAIL_INCLUDE,
};
