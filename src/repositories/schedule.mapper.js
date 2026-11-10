const FULL_DAYS = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const formatTimeHHMM = (timeVal) => {
  if (!timeVal) return null;
  if (timeVal instanceof Date) {
    return timeVal.toISOString().substring(11, 16);
  }
  return String(timeVal).substring(0, 5);
};

const formatDateYYYYMMDD = (dateVal) => {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return dateVal.toISOString().substring(0, 10);
  }
  return String(dateVal).substring(0, 10);
};

const mapCoachItem = (coachJoin) => {
  if (!coachJoin) return null;
  const coach = coachJoin.coach || coachJoin;
  const user = coach.user || {};
  return {
    id: coach.id,
    fullName: user.fullName || '',
    profileImageUrl: user.profileImageUrl || null,
  };
};

/**
 * Maps a ClassSlot database record to the API response format.
 * Persisted values are returned exact (e.g. null capacity stays null).
 * Enums and days are standardized; times are HH:mm strings.
 */
const toSlotResponse = (slot) => {
  if (!slot) return null;

  const coaches = Array.isArray(slot.coaches) ? slot.coaches.map(mapCoachItem).filter(Boolean) : [];

  return {
    id: slot.id,
    classId: slot.classId,
    dayOfWeek: slot.dayOfWeek,
    dayName: FULL_DAYS[slot.dayOfWeek] || '',
    startDate: formatDateYYYYMMDD(slot.startDate),
    startTime: formatTimeHHMM(slot.startTime),
    endTime: formatTimeHHMM(slot.endTime),
    capacity: slot.capacity ?? null,
    active: Boolean(slot.active),
    coaches,
    createdAt: slot.createdAt instanceof Date ? slot.createdAt.toISOString() : slot.createdAt,
    updatedAt: slot.updatedAt instanceof Date ? slot.updatedAt.toISOString() : slot.updatedAt,
  };
};

/**
 * Maps a ClassSession database record to the calendar / detail response shape.
 * Booking and waitlist counts are injected from stats adapter.
 * Enums (state, classType, source) are lowercased.
 */
const toSessionResponse = (session, stats = { bookedCount: 0, waitlistCount: 0 }) => {
  if (!session) return null;

  const coaches = Array.isArray(session.coaches)
    ? session.coaches.map(mapCoachItem).filter(Boolean)
    : [];

  const classData = session.class
    ? {
        id: session.class.id,
        name: session.class.name,
        classType: session.class.classType ? session.class.classType.toLowerCase() : 'onsite',
        intensity: session.class.intensity ?? null,
        durationMin: session.class.durationMin,
        baseCapacity: session.class.baseCapacity,
        colour: session.class.colour ?? null,
        photoUrl: session.class.photoUrl ?? null,
        timezone: session.class.timezone ?? 'Asia/Dubai',
      }
    : null;

  const overriddenFields = Array.isArray(session.overriddenFields) ? session.overriddenFields : [];

  const rawOverrideDetails = session.overrideDetails;
  const overrideDetails =
    rawOverrideDetails &&
    typeof rawOverrideDetails === 'object' &&
    !Array.isArray(rawOverrideDetails)
      ? rawOverrideDetails
      : {};

  return {
    id: session.id,
    classId: session.classId,
    slotId: session.slotId ?? null,
    className: session.class?.name ?? '',
    class: classData,
    startAt: session.startAt instanceof Date ? session.startAt.toISOString() : session.startAt,
    endAt: session.endAt instanceof Date ? session.endAt.toISOString() : session.endAt,
    durationMin: session.durationMin ?? session.class?.durationMin ?? 0,
    capacity: session.capacity,
    bookedCount: stats.bookedCount ?? 0,
    waitlistCount: stats.waitlistCount ?? 0,
    state: session.state ? session.state.toLowerCase() : 'open',
    isPrivate: Boolean(session.isPrivate),
    intensity: session.intensity ?? session.class?.intensity ?? null,
    classType: (session.classType || session.class?.classType || 'onsite').toLowerCase(),
    facility: session.facility ?? null,
    description: session.description ?? session.class?.description ?? null,
    image: session.image ?? session.class?.photoUrl ?? null,
    source: (session.source || (session.slotId ? 'GENERATED' : 'ONE_OFF')).toLowerCase(),
    overriddenFields,
    overrideDetails,
    cancelReason: session.cancelReason ?? null,
    coaches,
    version: session.version,
    createdAt:
      session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updatedAt:
      session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
  };
};

module.exports = {
  formatTimeHHMM,
  formatDateYYYYMMDD,
  toSlotResponse,
  toSessionResponse,
};
