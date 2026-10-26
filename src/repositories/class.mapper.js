const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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

const formatScheduleSummary = (slots = []) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    return {
      totalSlots: 0,
      days: [],
      summaryText: 'No recurring schedule',
    };
  }

  const uniqueDays = Array.from(new Set(slots.map((s) => s.dayOfWeek))).sort();
  const dayNames = uniqueDays.map((d) => FULL_DAYS[d]);
  const shortNames = uniqueDays.map((d) => DAY_NAMES[d]).join(', ');
  const slotCount = slots.length;
  const summaryText = `${shortNames} (${slotCount} ${slotCount === 1 ? 'slot' : 'slots'}/week)`;

  return {
    totalSlots: slotCount,
    days: dayNames,
    summaryText,
  };
};

/**
 * Maps a Prisma Class record (with included coaches, eligiblePlans, slots, sessions) to the API response shape.
 * Enums are lowercased (e.g. visibility: 'public' | 'private', status: 'active' | 'deactivated' | 'archived').
 * externalRef is explicitly excluded.
 * Both `status` and `active` (boolean, backward-compatibility) are provided.
 */
const toClassResponse = (classRow, options = {}) => {
  if (!classRow) return null;

  const coaches = Array.isArray(classRow.coaches)
    ? classRow.coaches
        .map((cc) => {
          if (!cc.coach) return null;
          return {
            id: cc.coach.id,
            fullName: cc.coach.user?.fullName ?? '',
            profileImageUrl: cc.coach.user?.profileImageUrl ?? null,
          };
        })
        .filter(Boolean)
    : [];

  const eligiblePlanIds = Array.isArray(classRow.eligiblePlans)
    ? classRow.eligiblePlans.map((ep) => ep.planId)
    : [];

  const eligiblePlans = Array.isArray(classRow.eligiblePlans)
    ? classRow.eligiblePlans.map((ep) => ({
        id: ep.plan?.id ?? ep.planId,
        name: ep.plan?.name ?? '',
      }))
    : undefined;

  const isActive = classRow.status ? classRow.status === 'ACTIVE' : Boolean(classRow.active);
  const statusStr = classRow.status
    ? classRow.status.toLowerCase()
    : isActive
      ? 'active'
      : 'deactivated';

  const scheduleSummary = formatScheduleSummary(classRow.slots);

  const response = {
    id: classRow.id,
    name: classRow.name,
    description: classRow.description ?? null,
    durationMin: classRow.durationMin,
    classType: classRow.classType ? classRow.classType.toLowerCase() : 'onsite',
    baseCapacity: classRow.baseCapacity,
    intensity: classRow.intensity ?? null,
    visibility: classRow.visibility ? classRow.visibility.toLowerCase() : 'public',
    classPassEnabled: Boolean(classRow.classPassEnabled),
    classpassSpots: classRow.classpassSpots ?? 0,
    colour: classRow.colour ?? null,
    photoUrl: classRow.photoUrl ?? null,
    status: statusStr,
    active: isActive,
    version: classRow.version,
    coaches,
    eligiblePlanIds,
    scheduleSummary,
    createdAt: classRow.createdAt,
    updatedAt: classRow.updatedAt,
  };

  if (options.isDetail) {
    response.eligiblePlans = eligiblePlans;
    if (Array.isArray(classRow.slots)) {
      response.recurringSchedule = classRow.slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        dayName: FULL_DAYS[s.dayOfWeek],
        startTime:
          s.startTime instanceof Date
            ? s.startTime.toISOString().substring(11, 16)
            : String(s.startTime).substring(0, 5),
        capacity: s.capacity,
        active: s.active,
        coaches: (s.coaches || [])
          .map((sc) => ({
            id: sc.coach?.id || sc.coachId,
            fullName: sc.coach?.user?.fullName || '',
          }))
          .filter(Boolean),
      }));
    }

    if (Array.isArray(classRow.sessions)) {
      response.upcomingInstancesSummary = {
        upcomingCount: classRow.sessions.length,
        nextSession: classRow.sessions[0]
          ? {
              id: classRow.sessions[0].id,
              startAt: classRow.sessions[0].startAt,
              endAt: classRow.sessions[0].endAt,
              capacity: classRow.sessions[0].capacity,
              state: classRow.sessions[0].state.toLowerCase(),
            }
          : null,
      };
    }
  }

  return response;
};

module.exports = { toClassResponse };
