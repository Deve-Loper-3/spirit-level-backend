const prisma = require('../config/prisma');
const env = require('../config/env');
const { Role } = require('../constants/roles');
const { ClassVisibility, SessionState } = require('../constants/class');
const {
  SessionSource,
  SESSION_ROLLING_WINDOW_DAYS,
  SESSION_OVERRIDE_FIELDS,
  SESSION_OVERRIDE_MANDATORY_REASON_FIELDS,
} = require('../constants/session');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');
const { createAppError } = require('../errors/AppError');
const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require('../constants/pagination');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');

const scheduleRepository = require('../repositories/schedule.repository');
const classRepository = require('../repositories/class.repository');
const {
  toSlotResponse,
  toSessionResponse,
  formatTimeHHMM,
  formatDateYYYYMMDD,
} = require('../repositories/schedule.mapper');
const {
  getBookingStats,
  getCancelOutcome,
  isCoachQualified,
  isCoachOnLeave,
} = require('./schedule.adapters');
const {
  localDateTimeToUtc,
  getTodayInTimezone,
  addDaysToDateStr,
  getIsoDayOfWeek,
} = require('../utils/timezone.util');
const { BookingRuleKey } = require('../constants/bookingRule');
const { getLimitValue } = require('./bookingRule.service');
const { limitToVisibleDays } = require('./bookingRule.guards');

const TX_OPTIONS = Object.freeze({ maxWait: 15000, timeout: 30000 });

// Visibility Enforcement Helper. What the caller may not see is reported as not found (404, with the
// resource's own error), never 403, so a hidden class or session looks the same as a missing one.
const assertClassReadableByUser = (classRecord, user, notFound = AppErrors.CLASS_NOT_FOUND) => {
  if (!classRecord) {
    throw createAppError(AppErrors.CLASS_NOT_FOUND);
  }

  const isActive = classRecord.status === 'ACTIVE';
  const isPublic = classRecord.visibility === ClassVisibility.PUBLIC;

  if (user.role === Role.MEMBER) {
    if (!isActive || !isPublic) {
      throw createAppError(notFound);
    }
  } else if (user.role === Role.COACH) {
    const isAssigned =
      Array.isArray(classRecord.coaches) &&
      classRecord.coaches.some(
        (cc) => cc.coach?.userId === user.id || (cc.coachId && user.coachId === cc.coachId),
      );

    if (!isPublic && !isAssigned) {
      throw createAppError(notFound);
    }
  }
};

// Coach Validation Helper
const validateCoachesForInterval = async ({
  coachIds = [],
  classRecord,
  startAt,
  endAt,
  excludeSessionId = null,
  client = prisma,
}) => {
  if (!coachIds || coachIds.length === 0) return;

  const dedupedIds = Array.from(new Set(coachIds));

  // 1. Verify coaches exist and are active
  const coaches = await scheduleRepository.findCoachesByIdsWithDetails(dedupedIds, client);
  const coachMap = new Map(coaches.map((c) => [c.id, c]));

  for (const coachId of dedupedIds) {
    const coach = coachMap.get(coachId);
    if (!coach || coach.status !== 'ACTIVE' || coach.user?.status === 'DISABLED') {
      throw createAppError(
        400,
        Messages.SESSION_COACH_NOT_ACTIVE(coachId),
        AppErrors.VALIDATION_ERROR.code,
        [{ field: 'coachIds', message: Messages.SESSION_COACH_NOT_ACTIVE_FIELD(coachId) }],
      );
    }
  }

  // 2. Verify coaches are assigned to the class template
  if (classRecord && Array.isArray(classRecord.coaches)) {
    const classCoachIds = new Set(
      classRecord.coaches.map((c) => c.coachId || c.coach?.id).filter(Boolean),
    );
    for (const coachId of dedupedIds) {
      if (!classCoachIds.has(coachId)) {
        throw createAppError(
          400,
          Messages.SESSION_COACH_NOT_ASSIGNED(coachId, classRecord.name || classRecord.id),
          AppErrors.VALIDATION_ERROR.code,
          [
            {
              field: 'coachIds',
              message: Messages.SESSION_COACH_NOT_ASSIGNED_FIELD(coachId),
            },
          ],
        );
      }
    }
  }

  // 3. Adapter checks: Qualification & Leave
  for (const coachId of dedupedIds) {
    const qualified = await isCoachQualified(coachId, classRecord?.id);
    if (!qualified) {
      throw createAppError(
        AppErrors.COACH_CONFLICT,
        Messages.SESSION_COACH_NOT_QUALIFIED(coachId),
        AppErrors.COACH_CONFLICT.code,
        {
          conflicts: [
            {
              type: 'COACH_UNQUALIFIED',
              coachId,
              classId: classRecord?.id,
              startAt: startAt instanceof Date ? startAt.toISOString() : startAt,
              endAt: endAt instanceof Date ? endAt.toISOString() : endAt,
            },
          ],
        },
      );
    }

    const onLeave = await isCoachOnLeave(coachId, startAt, endAt);
    if (onLeave) {
      throw createAppError(
        AppErrors.COACH_CONFLICT,
        Messages.SESSION_COACH_ON_LEAVE(coachId),
        AppErrors.COACH_CONFLICT.code,
        {
          conflicts: [
            {
              type: 'COACH_LEAVE',
              coachId,
              startAt: startAt instanceof Date ? startAt.toISOString() : startAt,
              endAt: endAt instanceof Date ? endAt.toISOString() : endAt,
            },
          ],
        },
      );
    }
  }

  // 4. Overlap check across all sessions
  for (const coachId of dedupedIds) {
    const overlapping = await scheduleRepository.findCoachOverlappingSessions(
      coachId,
      startAt,
      endAt,
      excludeSessionId,
      client,
    );

    if (overlapping.length > 0) {
      const conflictItems = overlapping.map((s) => ({
        type: 'COACH_CONFLICT',
        coachId,
        sessionId: s.id,
        slotId: s.slotId || null,
        startAt: s.startAt instanceof Date ? s.startAt.toISOString() : s.startAt,
        endAt: s.endAt instanceof Date ? s.endAt.toISOString() : s.endAt,
      }));

      throw createAppError(
        AppErrors.COACH_CONFLICT,
        Messages.COACH_CONFLICT,
        AppErrors.COACH_CONFLICT.code,
        { conflicts: conflictItems },
      );
    }
  }
};

// Rolling Generation Core Function
const generateSessionsForWindow = async ({
  classId,
  client = prisma,
  windowDays = SESSION_ROLLING_WINDOW_DAYS,
}) => {
  const classRecord = await classRepository.findById(classId, { isDetail: true }, client);
  if (!classRecord || classRecord.status !== 'ACTIVE') {
    return { generatedCount: 0, conflictCount: 0 };
  }

  const timezone = classRecord.timezone || env.FACILITY_TIMEZONE || 'Asia/Dubai';
  const todayStr = getTodayInTimezone(timezone);
  const nowUtc = new Date();

  const activeSlots = await scheduleRepository.findSlotsByClassId(
    classId,
    { includeInactive: false },
    client,
  );
  if (activeSlots.length === 0) {
    return { generatedCount: 0, conflictCount: 0, windowDays };
  }

  const windowEndDateStr = addDaysToDateStr(todayStr, windowDays + 1);
  const windowEndUtc = localDateTimeToUtc(windowEndDateStr, '23:59', timezone);

  // 1. Batch preload existing class sessions in rolling window
  const existingSessions = await client.classSession.findMany({
    where: {
      classId,
      startAt: { gte: nowUtc, lte: windowEndUtc },
    },
    select: { id: true, slotId: true, startAt: true, endAt: true },
  });
  const existingMap = new Map();
  for (const es of existingSessions) {
    existingMap.set(es.startAt.toISOString(), es);
  }

  // 2. Batch preload coaches across all active slots
  const allCoachIds = Array.from(
    new Set(
      activeSlots.flatMap((s) =>
        (s.coaches || []).map((c) => c.coachId || c.coach?.id).filter(Boolean),
      ),
    ),
  );
  const coaches = await scheduleRepository.findCoachesByIdsWithDetails(allCoachIds, client);
  const coachMap = new Map(coaches.map((c) => [c.id, c]));

  // 3. Batch preload existing overlapping coach sessions in rolling window
  const coachOverlapping =
    allCoachIds.length > 0
      ? await client.classSession.findMany({
          where: {
            state: { not: 'CANCELLED' },
            startAt: { lt: windowEndUtc },
            endAt: { gt: nowUtc },
            coaches: { some: { coachId: { in: allCoachIds } } },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            coaches: { select: { coachId: true } },
          },
        })
      : [];

  let generatedCount = 0;
  let conflictCount = 0;

  for (const slot of activeSlots) {
    const startTimeStr = formatTimeHHMM(slot.startTime);
    const endTimeStr = formatTimeHHMM(slot.endTime);
    const slotStartDateStr = formatDateYYYYMMDD(slot.startDate);
    const slotCoachIds = (slot.coaches || []).map((c) => c.coachId || c.coach?.id).filter(Boolean);
    const capacity = slot.capacity || classRecord.baseCapacity;

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
      const candidateDateStr = addDaysToDateStr(todayStr, dayOffset);

      if (candidateDateStr < slotStartDateStr) continue;
      if (getIsoDayOfWeek(candidateDateStr) !== slot.dayOfWeek) continue;

      const candidateStartAt = localDateTimeToUtc(candidateDateStr, startTimeStr, timezone);
      const candidateEndAt = localDateTimeToUtc(candidateDateStr, endTimeStr, timezone);

      if (candidateStartAt <= nowUtc) continue;

      // In-memory check if session already exists at startAt
      const existing = existingMap.get(candidateStartAt.toISOString());
      if (existing) {
        if (existing.slotId !== slot.id) {
          conflictCount += 1;
        }
        continue;
      }

      // In-memory coach availability check
      let coachConflict = false;
      for (const coachId of slotCoachIds) {
        const coach = coachMap.get(coachId);
        if (!coach || coach.status !== 'ACTIVE' || coach.user?.status === 'DISABLED') {
          coachConflict = true;
          break;
        }
        const qualified = await isCoachQualified(coachId, classId);
        if (!qualified) {
          coachConflict = true;
          break;
        }
        const onLeave = await isCoachOnLeave(coachId, candidateStartAt, candidateEndAt);
        if (onLeave) {
          coachConflict = true;
          break;
        }
        const hasOverlap = coachOverlapping.some(
          (s) =>
            s.coaches.some((c) => c.coachId === coachId) &&
            s.startAt < candidateEndAt &&
            s.endAt > candidateStartAt,
        );
        if (hasOverlap) {
          coachConflict = true;
          break;
        }
      }

      if (coachConflict) {
        conflictCount += 1;
        continue;
      }

      // Insert generated session
      try {
        const createdSession = await scheduleRepository.createSession(
          {
            classId,
            slotId: slot.id,
            startAt: candidateStartAt,
            endAt: candidateEndAt,
            capacity,
            state: SessionState.OPEN,
            isPrivate: classRecord.visibility === ClassVisibility.PRIVATE,
            source: SessionSource.GENERATED,
            durationMin: classRecord.durationMin,
            intensity: classRecord.intensity,
            classType: classRecord.classType,
            description: classRecord.description,
            image: classRecord.photoUrl,
            overriddenFields: [],
            overrideDetails: {},
          },
          slotCoachIds,
          client,
        );
        generatedCount += 1;
        existingMap.set(candidateStartAt.toISOString(), createdSession);
        coachOverlapping.push({
          id: createdSession.id,
          startAt: candidateStartAt,
          endAt: candidateEndAt,
          coaches: slotCoachIds.map((cid) => ({ coachId: cid })),
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) {
          throw err;
        }
        conflictCount += 1;
      }
    }
  }

  return { generatedCount, conflictCount, windowDays };
};

// Slot Reconciliation Helper
const reconcileSlotChange = async ({ slotId, client = prisma }) => {
  const slot = await scheduleRepository.findSlotById(slotId, client);
  if (!slot) return;

  const classRecord = slot.class;
  const timezone = classRecord?.timezone || env.FACILITY_TIMEZONE || 'Asia/Dubai';
  const nowUtc = new Date();
  const startTimeStr = formatTimeHHMM(slot.startTime);
  const endTimeStr = formatTimeHHMM(slot.endTime);
  const slotCoachIds = (slot.coaches || []).map((c) => c.coachId || c.coach?.id).filter(Boolean);
  const defaultCapacity = slot.capacity || classRecord?.baseCapacity;

  const futureSessions = await scheduleRepository.findGeneratedFutureSessionsForSlot(
    slotId,
    nowUtc,
    client,
  );

  for (const session of futureSessions) {
    const stats = await getBookingStats(session.id);
    if (stats.bookedCount > 0) {
      // Booked sessions must never be touched by reconciliation
      continue;
    }

    const overridden = session.overriddenFields || [];
    const updateData = {};
    let newCoachIds = null;

    // Time moved: only update if startAt/endAt not overridden
    if (!overridden.includes('startAt') && !overridden.includes('endAt')) {
      const sessionDateStr = formatDateYYYYMMDD(session.startAt);
      const newStartAt = localDateTimeToUtc(sessionDateStr, startTimeStr, timezone);
      const newEndAt = localDateTimeToUtc(sessionDateStr, endTimeStr, timezone);

      // Verify no conflict at new startAt
      const existingAtNewTime = await scheduleRepository.findSessionAtStartTime(
        slot.classId,
        newStartAt,
        session.id,
        client,
      );
      if (!existingAtNewTime) {
        updateData.startAt = newStartAt;
        updateData.endAt = newEndAt;
      }
    }

    // Coaches: only update if coachIds not overridden
    if (!overridden.includes('coachIds')) {
      newCoachIds = slotCoachIds;
    }

    // Capacity: only update if capacity not overridden
    if (!overridden.includes('capacity')) {
      updateData.capacity = defaultCapacity;
    }

    if (Object.keys(updateData).length > 0 || newCoachIds !== null) {
      await scheduleRepository.updateSession(session.id, updateData, newCoachIds, client);
    }
  }

  // Generate missing occurrences in the 21-day window
  await generateSessionsForWindow({ classId: slot.classId, client });
};

// ==========================================
// Slot Service Functions (BE-SCH-2)
// ==========================================

const listSlots = async ({ classId, user, query = {} }) => {
  const classRecord = await classRepository.findById(classId);
  assertClassReadableByUser(classRecord, user);

  const includeInactive = query.includeInactive === 'true' && user.role !== Role.MEMBER;
  const slots = await scheduleRepository.findSlotsByClassId(classId, { includeInactive });

  return slots.map(toSlotResponse);
};

const createSlots = async ({ classId, payload, user: _user }) => {
  return prisma.$transaction(async (tx) => {
    // Acquire class-level advisory lock
    await scheduleRepository.acquireClassAdvisoryLock(classId, tx);

    const classRecord = await classRepository.findById(classId, { isDetail: true }, tx);
    if (!classRecord) {
      throw createAppError(AppErrors.CLASS_NOT_FOUND);
    }
    if (classRecord.status !== 'ACTIVE') {
      throw createAppError(AppErrors.CLASS_INACTIVE);
    }

    const { startDate, days = [] } = payload;
    const timezone = classRecord.timezone || env.FACILITY_TIMEZONE || 'Asia/Dubai';
    const todayStr = getTodayInTimezone(timezone);

    if (startDate < todayStr) {
      throw createAppError(
        400,
        Messages.SLOT_START_DATE_IN_PAST(startDate, todayStr),
        AppErrors.VALIDATION_ERROR.code,
        [{ field: 'startDate', message: Messages.SLOT_START_DATE_PAST_FIELD }],
      );
    }

    const createdSlots = [];

    for (const dayEntry of days) {
      const { dayOfWeek, times = [] } = dayEntry;

      for (const timeEntry of times) {
        const { startTime, endTime, coachIds = [], capacity } = timeEntry;

        // Check active slot conflict in database
        const existingSlot = await scheduleRepository.findActiveSlotConflict(
          classId,
          dayOfWeek,
          startTime,
          null,
          tx,
        );
        if (existingSlot) {
          throw createAppError(
            AppErrors.SLOT_CONFLICT,
            Messages.SLOT_CONFLICT,
            AppErrors.SLOT_CONFLICT.code,
            {
              conflicts: [
                {
                  type: 'SLOT_CONFLICT',
                  slotId: existingSlot.id,
                  dayOfWeek,
                  startTime,
                },
              ],
            },
          );
        }

        // Validate coach assignments
        if (coachIds.length > 0) {
          // Calculate arbitrary start/end timestamp to check coaches
          const sampleStart = localDateTimeToUtc(startDate, startTime, timezone);
          const sampleEnd = localDateTimeToUtc(startDate, endTime, timezone);
          await validateCoachesForInterval({
            coachIds,
            classRecord,
            startAt: sampleStart,
            endAt: sampleEnd,
            excludeSessionId: null,
            client: tx,
          });
        }

        const slot = await scheduleRepository.createSlotWithCoaches(
          {
            classId,
            dayOfWeek,
            startDate,
            startTime,
            endTime,
            capacity: capacity ?? null,
            coachIds,
          },
          tx,
        );

        createdSlots.push(slot);
      }
    }

    // Trigger reconciliation/generation in rolling window
    const reconciliation = await generateSessionsForWindow({ classId, client: tx });

    return {
      slots: createdSlots.map(toSlotResponse),
      reconciliation,
    };
  }, TX_OPTIONS);
};

const updateSlot = async ({ slotId, classId, payload, user: _user }) => {
  return prisma.$transaction(async (tx) => {
    await scheduleRepository.acquireClassAdvisoryLock(classId, tx);

    const slot = await scheduleRepository.findSlotById(slotId, tx);
    if (!slot || slot.classId !== classId) {
      throw createAppError(AppErrors.SLOT_NOT_FOUND);
    }

    const classRecord = slot.class;
    if (classRecord.status !== 'ACTIVE') {
      throw createAppError(AppErrors.CLASS_INACTIVE);
    }

    const { dayOfWeek, startDate, startTime, endTime, capacity, coachIds, active } = payload;

    // Check slot conflict if dayOfWeek or startTime changed
    const targetDay = dayOfWeek !== undefined ? dayOfWeek : slot.dayOfWeek;
    const targetStartTime = startTime !== undefined ? startTime : formatTimeHHMM(slot.startTime);

    if (dayOfWeek !== undefined || startTime !== undefined) {
      const conflict = await scheduleRepository.findActiveSlotConflict(
        classId,
        targetDay,
        targetStartTime,
        slotId,
        tx,
      );
      if (conflict) {
        throw createAppError(
          AppErrors.SLOT_CONFLICT,
          Messages.SLOT_CONFLICT,
          AppErrors.SLOT_CONFLICT.code,
          {
            conflicts: [
              {
                type: 'SLOT_CONFLICT',
                slotId: conflict.id,
                dayOfWeek: targetDay,
                startTime: targetStartTime,
              },
            ],
          },
        );
      }
    }

    // Validate coaches if updated
    if (coachIds !== undefined && coachIds !== null && coachIds.length > 0) {
      const timezone = classRecord.timezone || env.FACILITY_TIMEZONE || 'Asia/Dubai';
      const targetStartDate =
        startDate !== undefined ? startDate : formatDateYYYYMMDD(slot.startDate);
      const targetEndTime = endTime !== undefined ? endTime : formatTimeHHMM(slot.endTime);
      const sampleStart = localDateTimeToUtc(targetStartDate, targetStartTime, timezone);
      const sampleEnd = localDateTimeToUtc(targetStartDate, targetEndTime, timezone);

      await validateCoachesForInterval({
        coachIds,
        classRecord,
        startAt: sampleStart,
        endAt: sampleEnd,
        excludeSessionId: null,
        client: tx,
      });
    }

    const updatedSlot = await scheduleRepository.updateSlot(
      slotId,
      {
        dayOfWeek,
        startDate,
        startTime,
        endTime,
        capacity,
        active,
      },
      coachIds,
      tx,
    );

    // Reconcile affected future instances
    await reconcileSlotChange({ slotId, client: tx });

    return toSlotResponse(updatedSlot);
  }, TX_OPTIONS);
};

const deleteSlot = async ({ slotId, classId, user: _user }) => {
  return prisma.$transaction(async (tx) => {
    await scheduleRepository.acquireClassAdvisoryLock(classId, tx);

    const slot = await scheduleRepository.findSlotById(slotId, tx);
    if (!slot || slot.classId !== classId) {
      throw createAppError(AppErrors.SLOT_NOT_FOUND);
    }

    // Soft-deactivate slot
    await scheduleRepository.softDeactivateSlot(slotId, tx);

    // Rule: remove/cancel only future, unbooked, non-overridden GENERATED sessions
    const nowUtc = new Date();
    const futureSessions = await scheduleRepository.findGeneratedFutureSessionsForSlot(
      slotId,
      nowUtc,
      tx,
    );

    const sessionsToDelete = [];
    for (const session of futureSessions) {
      const stats = await getBookingStats(session.id);
      if (stats.bookedCount > 0) {
        continue;
      }
      if (Array.isArray(session.overriddenFields) && session.overriddenFields.length > 0) {
        continue;
      }
      sessionsToDelete.push(session.id);
    }

    if (sessionsToDelete.length > 0) {
      await scheduleRepository.deleteSessionsByIds(sessionsToDelete, tx);
    }

    return {
      id: slotId,
      active: false,
      removedSessionsCount: sessionsToDelete.length,
    };
  }, TX_OPTIONS);
};

// ==========================================
// Session Service Functions (BE-SCH-1, BE-SCH-3)
// ==========================================

const listSessions = async ({ user, query }) => {
  const {
    from,
    to,
    classId,
    coachId,
    state,
    isPrivate,
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
  } = query;

  // A member only sees the timetable up to the visibility rule (read time only, so it applies to
  // existing and future sessions alike). Staff and coaches are not capped.
  const visibleDays =
    user.role === Role.MEMBER ? await getLimitValue(BookingRuleKey.TIMETABLE_VISIBLE_AHEAD) : null;
  const range = limitToVisibleDays({
    from: new Date(from),
    to: new Date(to),
    now: new Date(),
    days: visibleDays,
  });
  if (range === null) {
    return { sessions: [], pagination: buildPagination({ page, limit, total: 0 }) };
  }

  // If MEMBER: filter to public active classes
  // If COACH: filter to public active classes OR classes they are assigned to
  const { sessions } = await scheduleRepository.findSessions({
    from: range.from,
    to: range.to,
    classId,
    coachId,
    state,
    isPrivate,
    ...toSkipTake({ page, limit }),
  });

  // Apply RBAC filtering on results
  const visibleSessions = sessions.filter((session) => {
    const classRecord = session.class;
    if (!classRecord) return false;

    if (user.role === Role.MEMBER) {
      return (
        classRecord.status === 'ACTIVE' &&
        classRecord.visibility === ClassVisibility.PUBLIC &&
        !session.isPrivate
      );
    }

    if (user.role === Role.COACH) {
      const isPublic =
        classRecord.status === 'ACTIVE' && classRecord.visibility === ClassVisibility.PUBLIC;
      const isAssigned =
        session.coaches.some((c) => c.coach?.userId === user.id || c.coachId === user.coachId) ||
        classRecord.coaches.some((c) => c.coachId === user.coachId);
      return isPublic || isAssigned;
    }

    return true; // OWNER, ADMIN
  });

  const sessionResponses = await Promise.all(
    visibleSessions.map(async (s) => {
      const stats = await getBookingStats(s.id);
      return toSessionResponse(s, stats);
    }),
  );

  return {
    sessions: sessionResponses,
    pagination: buildPagination({ page, limit, total: visibleSessions.length }),
  };
};

const getSession = async ({ sessionId, user }) => {
  const session = await scheduleRepository.findSessionById(sessionId);
  if (!session) {
    throw createAppError(AppErrors.SESSION_NOT_FOUND);
  }

  assertClassReadableByUser(session.class, user, AppErrors.SESSION_NOT_FOUND);

  if (user.role === Role.MEMBER && session.isPrivate) {
    throw createAppError(AppErrors.SESSION_NOT_FOUND);
  }

  const stats = await getBookingStats(sessionId);
  return toSessionResponse(session, stats);
};

const createSession = async ({ payload, user: _user }) => {
  const {
    classId,
    startAt,
    endAt,
    durationMin,
    coachIds,
    capacity,
    intensity,
    classType,
    facility,
    description,
    image,
    isPrivate,
  } = payload;

  const startUtc = new Date(startAt);
  const endUtc = new Date(endAt);

  return prisma.$transaction(async (tx) => {
    await scheduleRepository.acquireClassAdvisoryLock(classId, tx);

    const classRecord = await classRepository.findById(classId, { isDetail: true }, tx);
    if (!classRecord) {
      throw createAppError(AppErrors.CLASS_NOT_FOUND);
    }
    if (classRecord.status !== 'ACTIVE') {
      throw createAppError(AppErrors.CLASS_INACTIVE);
    }

    // startAt must be future
    if (startUtc <= new Date()) {
      throw createAppError(400, Messages.SESSION_START_IN_PAST, AppErrors.VALIDATION_ERROR.code, [
        { field: 'startAt', message: Messages.SESSION_START_IN_PAST_FIELD },
      ]);
    }

    if (endUtc <= startUtc) {
      throw createAppError(
        400,
        Messages.SESSION_END_NOT_AFTER_START,
        AppErrors.VALIDATION_ERROR.code,
        [{ field: 'endAt', message: Messages.SESSION_END_NOT_AFTER_START_FIELD }],
      );
    }

    // Verify durationMin matches
    const calculatedDuration = Math.round((endUtc.getTime() - startUtc.getTime()) / 60000);
    const finalDuration = durationMin !== undefined ? durationMin : classRecord.durationMin;
    if (calculatedDuration !== finalDuration) {
      throw createAppError(
        400,
        Messages.SESSION_DURATION_MISMATCH(finalDuration, calculatedDuration),
        AppErrors.VALIDATION_ERROR.code,
        [
          {
            field: 'durationMin',
            message: Messages.SESSION_DURATION_MISMATCH_FIELD,
          },
        ],
      );
    }

    // Same-class same-startAt check (never allow duplicate sessions for the same class at the same start time)
    const existingAtStart = await scheduleRepository.findSessionAtStartTime(
      classId,
      startUtc,
      null,
      tx,
    );
    if (existingAtStart) {
      throw createAppError(
        AppErrors.SESSION_CONFLICT,
        Messages.SESSION_CONFLICT,
        AppErrors.SESSION_CONFLICT.code,
        {
          conflicts: [
            {
              type: 'SESSION_CONFLICT',
              sessionId: existingAtStart.id,
              startAt: existingAtStart.startAt.toISOString(),
              endAt: existingAtStart.endAt.toISOString(),
            },
          ],
        },
      );
    }

    // Final coaches list inherits from template if omitted
    const templateCoachIds = (classRecord.coaches || [])
      .map((c) => c.coachId || c.coach?.id)
      .filter(Boolean);
    const targetCoachIds = coachIds !== undefined ? coachIds : templateCoachIds;

    // Validate coaches
    await validateCoachesForInterval({
      coachIds: targetCoachIds,
      classRecord,
      startAt: startUtc,
      endAt: endUtc,
      excludeSessionId: null,
      client: tx,
    });

    const session = await scheduleRepository.createSession(
      {
        classId,
        slotId: null, // Always null for one-off
        startAt: startUtc,
        endAt: endUtc,
        durationMin: finalDuration,
        capacity: capacity !== undefined && capacity !== null ? capacity : classRecord.baseCapacity,
        intensity: intensity !== undefined ? intensity : classRecord.intensity,
        classType: classType !== undefined ? classType.toUpperCase() : classRecord.classType,
        facility: facility ?? null,
        description: description !== undefined ? description : classRecord.description,
        image: image !== undefined ? image : classRecord.photoUrl,
        state: SessionState.OPEN,
        isPrivate:
          isPrivate !== undefined ? isPrivate : classRecord.visibility === ClassVisibility.PRIVATE,
        source: SessionSource.ONE_OFF,
        overriddenFields: [],
        overrideDetails: {},
      },
      targetCoachIds,
      tx,
    );

    const stats = await getBookingStats(session.id);
    return toSessionResponse(session, stats);
  }, TX_OPTIONS);
};

const patchSession = async ({ sessionId, payload, user }) => {
  return prisma.$transaction(async (tx) => {
    const session = await scheduleRepository.findSessionById(sessionId, tx);
    if (!session) {
      throw createAppError(AppErrors.SESSION_NOT_FOUND);
    }

    const classRecord = session.class;
    await scheduleRepository.acquireClassAdvisoryLock(session.classId, tx);

    // Past sessions are immutable
    if (session.startAt <= new Date()) {
      throw createAppError(AppErrors.SESSION_PAST_IMMUTABLE);
    }

    const stats = await getBookingStats(sessionId);
    const isCoach = user.role === Role.COACH;

    // Coach role check: capacity only on own session
    if (isCoach) {
      const isAssigned = session.coaches.some(
        (c) => c.coach?.userId === user.id || c.coachId === user.coachId,
      );
      if (!isAssigned) {
        throw createAppError(AppErrors.FORBIDDEN);
      }

      const payloadKeys = Object.keys(payload).filter(
        (k) => k !== 'overrideReasons' && k !== 'version',
      );
      if (payloadKeys.length !== 1 || payloadKeys[0] !== 'capacity') {
        throw createAppError(
          AppErrors.FORBIDDEN,
          Messages.SESSION_COACH_CAPACITY_ONLY,
          AppErrors.FORBIDDEN.code,
        );
      }
    }

    const {
      capacity,
      startAt,
      endAt,
      durationMin,
      coachIds,
      intensity,
      classType,
      facility,
      description,
      image,
      isPrivate,
      overrideReasons = {},
      version,
    } = payload;

    // Capacity validation
    if (capacity !== undefined) {
      if (capacity < stats.bookedCount) {
        throw createAppError(AppErrors.CAPACITY_BELOW_BOOKED);
      }
    }

    // Date/time validation if startAt or endAt modified
    const targetStartAt = startAt ? new Date(startAt) : session.startAt;
    const targetEndAt = endAt ? new Date(endAt) : session.endAt;

    if (startAt || endAt) {
      if (targetStartAt <= new Date()) {
        throw createAppError(400, Messages.SESSION_START_IN_PAST, AppErrors.VALIDATION_ERROR.code, [
          { field: 'startAt', message: Messages.SESSION_START_IN_PAST_FIELD },
        ]);
      }
      if (targetEndAt <= targetStartAt) {
        throw createAppError(
          400,
          Messages.SESSION_END_NOT_AFTER_START,
          AppErrors.VALIDATION_ERROR.code,
          [{ field: 'endAt', message: Messages.SESSION_END_NOT_AFTER_START_FIELD }],
        );
      }

      // Check same-startAt conflict
      const existingAtStart = await scheduleRepository.findSessionAtStartTime(
        session.classId,
        targetStartAt,
        session.id,
        tx,
      );
      if (existingAtStart) {
        throw createAppError(
          AppErrors.SESSION_CONFLICT,
          Messages.SESSION_CONFLICT,
          AppErrors.SESSION_CONFLICT.code,
          {
            conflicts: [
              {
                type: 'SESSION_CONFLICT',
                sessionId: existingAtStart.id,
                startAt: existingAtStart.startAt.toISOString(),
                endAt: existingAtStart.endAt.toISOString(),
              },
            ],
          },
        );
      }
    }

    // Coaches validation if coaches or time changed
    const targetCoachIds =
      coachIds !== undefined
        ? coachIds
        : session.coaches.map((c) => c.coachId || c.coach?.id).filter(Boolean);

    if (coachIds !== undefined || startAt !== undefined || endAt !== undefined) {
      await validateCoachesForInterval({
        coachIds: targetCoachIds,
        classRecord,
        startAt: targetStartAt,
        endAt: targetEndAt,
        excludeSessionId: session.id,
        client: tx,
      });
    }

    // Validate mandatory override reasons
    for (const mandatoryField of SESSION_OVERRIDE_MANDATORY_REASON_FIELDS) {
      if (mandatoryField === 'cancel') continue;
      if (payload[mandatoryField] !== undefined) {
        const reason = overrideReasons[mandatoryField];
        if (!reason || typeof reason !== 'string' || reason.trim() === '') {
          throw createAppError(
            400,
            Messages.SESSION_OVERRIDE_REASON_REQUIRED(mandatoryField),
            AppErrors.VALIDATION_ERROR.code,
            [
              {
                field: `overrideReasons.${mandatoryField}`,
                message: Messages.SESSION_OVERRIDE_REASON_FIELD,
              },
            ],
          );
        }
      }
    }

    // Build update data and override tracking
    const updateData = {};
    if (capacity !== undefined) updateData.capacity = capacity;
    if (startAt !== undefined) updateData.startAt = targetStartAt;
    if (endAt !== undefined) updateData.endAt = targetEndAt;
    if (durationMin !== undefined) updateData.durationMin = durationMin;
    if (intensity !== undefined) updateData.intensity = intensity;
    if (classType !== undefined) updateData.classType = classType.toUpperCase();
    if (facility !== undefined) updateData.facility = facility;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate;

    // Track overridden fields
    const updatedOverriddenFields = new Set(session.overriddenFields || []);
    const updatedOverrideDetails = { ...(session.overrideDetails || {}) };
    const changedTimestamp = new Date().toISOString();

    for (const field of SESSION_OVERRIDE_FIELDS) {
      if (field === 'cancel') continue;
      if (payload[field] !== undefined) {
        updatedOverriddenFields.add(field);
        updatedOverrideDetails[field] = {
          reason: overrideReasons[field] ? String(overrideReasons[field]).trim() : null,
          actorId: user.id,
          changedAt: changedTimestamp,
        };
      }
    }

    updateData.overriddenFields = Array.from(updatedOverriddenFields);
    updateData.overrideDetails = updatedOverrideDetails;
    if (typeof version === 'number') {
      updateData.expectedVersion = version;
    }

    const updatedSession = await scheduleRepository.updateSession(
      sessionId,
      updateData,
      coachIds !== undefined ? targetCoachIds : null,
      tx,
    );

    if (!updatedSession) {
      throw createAppError(AppErrors.SESSION_VERSION_CONFLICT);
    }

    return toSessionResponse(updatedSession, stats);
  }, TX_OPTIONS);
};

const cancelSession = async ({ sessionId, payload, user }) => {
  return prisma.$transaction(async (tx) => {
    const session = await scheduleRepository.findSessionById(sessionId, tx);
    if (!session) {
      throw createAppError(AppErrors.SESSION_NOT_FOUND);
    }

    await scheduleRepository.acquireClassAdvisoryLock(session.classId, tx);

    if (session.startAt <= new Date()) {
      throw createAppError(AppErrors.SESSION_PAST_IMMUTABLE);
    }

    const { reason } = payload;
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw createAppError(AppErrors.CANCEL_REASON_REQUIRED);
    }

    const stats = await getBookingStats(sessionId);

    // Role check
    if (user.role === Role.COACH) {
      const isAssigned = session.coaches.some(
        (c) => c.coach?.userId === user.id || c.coachId === user.coachId,
      );
      if (!isAssigned || stats.bookedCount > 0) {
        throw createAppError(AppErrors.FORBIDDEN);
      }
    } else if (user.role === Role.MEMBER) {
      throw createAppError(AppErrors.FORBIDDEN);
    }

    // Call cancellation outcome seam
    const outcome = await getCancelOutcome(sessionId, reason);

    const updatedOverriddenFields = Array.from(
      new Set([...(session.overriddenFields || []), 'cancel']),
    );
    const updatedOverrideDetails = {
      ...(session.overrideDetails || {}),
      cancel: {
        reason: reason.trim(),
        actorId: user.id,
        changedAt: new Date().toISOString(),
      },
    };

    await scheduleRepository.updateSession(
      sessionId,
      {
        state: SessionState.CANCELLED,
        cancelReason: reason.trim(),
        overriddenFields: updatedOverriddenFields,
        overrideDetails: updatedOverrideDetails,
      },
      null,
      tx,
    );

    return {
      id: sessionId,
      state: 'cancelled',
      outcome,
    };
  }, TX_OPTIONS);
};

const restoreSession = async ({ sessionId, user: _user }) => {
  return prisma.$transaction(async (tx) => {
    const session = await scheduleRepository.findSessionById(sessionId, tx);
    if (!session) {
      throw createAppError(AppErrors.SESSION_NOT_FOUND);
    }

    await scheduleRepository.acquireClassAdvisoryLock(session.classId, tx);

    if (session.startAt <= new Date()) {
      throw createAppError(AppErrors.SESSION_PAST_IMMUTABLE);
    }

    if (session.state !== SessionState.CANCELLED) {
      throw createAppError(AppErrors.SESSION_NOT_CANCELLED);
    }

    // Re-check same-startAt conflict
    const conflictAtStart = await scheduleRepository.findSessionAtStartTime(
      session.classId,
      session.startAt,
      session.id,
      tx,
    );
    if (conflictAtStart) {
      throw createAppError(
        AppErrors.SESSION_CONFLICT,
        Messages.SESSION_CONFLICT,
        AppErrors.SESSION_CONFLICT.code,
        {
          conflicts: [
            {
              type: 'SESSION_CONFLICT',
              sessionId: conflictAtStart.id,
              startAt: conflictAtStart.startAt.toISOString(),
              endAt: conflictAtStart.endAt.toISOString(),
            },
          ],
        },
      );
    }

    // Re-check coach conflicts
    const coachIds = session.coaches.map((c) => c.coachId || c.coach?.id).filter(Boolean);
    await validateCoachesForInterval({
      coachIds,
      classRecord: session.class,
      startAt: session.startAt,
      endAt: session.endAt,
      excludeSessionId: session.id,
      client: tx,
    });

    const updatedOverrideDetails = { ...(session.overrideDetails || {}) };
    delete updatedOverrideDetails.cancel;
    const updatedOverriddenFields = (session.overriddenFields || []).filter((f) => f !== 'cancel');

    const restored = await scheduleRepository.updateSession(
      sessionId,
      {
        state: SessionState.OPEN,
        cancelReason: null,
        overriddenFields: updatedOverriddenFields,
        overrideDetails: updatedOverrideDetails,
      },
      null,
      tx,
    );

    const stats = await getBookingStats(sessionId);
    return toSessionResponse(restored, stats);
  }, TX_OPTIONS);
};

module.exports = {
  localDateTimeToUtc,
  getTodayInTimezone,
  addDaysToDateStr,
  getIsoDayOfWeek,
  generateSessionsForWindow,
  reconcileSlotChange,
  listSlots,
  createSlots,
  updateSlot,
  deleteSlot,
  listSessions,
  getSession,
  createSession,
  patchSession,
  cancelSession,
  restoreSession,
};
