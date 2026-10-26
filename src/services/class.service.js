const { Role } = require('../constants/roles');
const { ClassVisibility, ClassStatus } = require('../constants/class');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');
const { createAppError } = require('../errors/AppError');
const { isUniqueConstraintError } = require('../utils/prismaError.util');
const classRepository = require('../repositories/class.repository');
const {
  findActiveByName,
  listClasses: repositoryListClasses,
  createClassWithPlans,
  updateClass: repositoryUpdateClass,
  deactivateClass: repositoryDeactivateClass,
  activateClass: repositoryActivateClass,
  archiveClass: repositoryArchiveClass,
  replaceEligiblePlans,
  validatePlanIds,
  validateCoachIds,
} = classRepository;

const { toClassResponse } = require('../repositories/class.mapper');

const buildClassWhere = ({ user, query }) => {
  const { visibility, active, status } = query;

  if (user.role === Role.MEMBER) {
    // Members see only active public classes
    return {
      status: 'ACTIVE',
      visibility: ClassVisibility.PUBLIC,
    };
  }

  if (user.role === Role.COACH) {
    // Coaches see all active public classes plus classes they are assigned to
    const coachCondition = {
      coaches: {
        some: {
          coach: {
            userId: user.id,
          },
        },
      },
    };

    const baseWhere = {
      OR: [{ status: 'ACTIVE', visibility: ClassVisibility.PUBLIC }, coachCondition],
    };

    if (visibility) {
      baseWhere.visibility = visibility.toUpperCase();
    }
    if (status) {
      if (status !== 'all') {
        baseWhere.status = status.toUpperCase();
      }
    } else if (active === 'true') {
      baseWhere.status = 'ACTIVE';
    } else if (active === 'false') {
      baseWhere.status = 'DEACTIVATED';
    }

    return baseWhere;
  }

  // Staff (OWNER, ADMIN):
  const staffWhere = {};

  if (status) {
    if (status === 'all') {
      // no status filter: includes ACTIVE, DEACTIVATED, ARCHIVED
    } else {
      staffWhere.status = status.toUpperCase();
    }
  } else if (active !== undefined) {
    if (active === 'false') {
      staffWhere.status = 'DEACTIVATED';
    } else if (active === 'all') {
      // no status filter
    } else if (active === 'true') {
      staffWhere.status = 'ACTIVE';
    }
  } else {
    // Staff default list excludes ARCHIVED
    staffWhere.status = { in: ['ACTIVE', 'DEACTIVATED'] };
  }

  if (visibility) {
    staffWhere.visibility = visibility.toUpperCase();
  }

  return staffWhere;
};

const listClasses = async ({ user, query }) => {
  const page = query.page || 1;
  const pageSize = query.pageSize || 100;
  const where = buildClassWhere({ user, query });

  const { classes, total } = await repositoryListClasses({ where, page, pageSize });

  return {
    classes: classes.map(toClassResponse),
    meta: {
      page,
      pageSize,
      total,
    },
  };
};

const getClass = async ({ user, classRecord }) => {
  const isActive =
    classRecord.status ? classRecord.status === 'ACTIVE' : Boolean(classRecord.active);

  if (user.role === Role.MEMBER) {
    if (!isActive || classRecord.visibility !== ClassVisibility.PUBLIC) {
      throw createAppError(AppErrors.CLASS_NOT_FOUND);
    }
  } else if (user.role === Role.COACH) {
    const isPublicActive = isActive && classRecord.visibility === ClassVisibility.PUBLIC;
    const isAssigned =
      Array.isArray(classRecord.coaches) &&
      classRecord.coaches.some((cc) => cc.coach && cc.coach.userId === user.id);

    if (!isPublicActive && !isAssigned) {
      throw createAppError(AppErrors.CLASS_NOT_FOUND);
    }
  }

  return toClassResponse(classRecord, { isDetail: true });
};

const createClass = async ({ payload }) => {
  const { eligiblePlanIds = [], coachIds = [], ...data } = payload;
  const dedupedPlanIds = Array.from(new Set(eligiblePlanIds));
  const dedupedCoachIds = Array.from(new Set(coachIds));

  if (data.visibility === ClassVisibility.PUBLIC && dedupedPlanIds.length === 0) {
    throw createAppError(
      422,
      Messages.CLASS_PUBLIC_REQUIRES_PLANS,
      AppErrors.VALIDATION_ERROR.code,
      [{ field: 'eligiblePlanIds', message: Messages.CLASS_PUBLIC_REQUIRES_PLANS }],
    );
  }

  if (dedupedPlanIds.length > 0) {
    const planCheck = await validatePlanIds(dedupedPlanIds);
    if (!planCheck.valid) {
      if (planCheck.unknownIds.length > 0) {
        throw createAppError(422, Messages.CLASS_PLAN_NOT_FOUND, AppErrors.VALIDATION_ERROR.code, [
          { field: 'eligiblePlanIds', message: Messages.CLASS_PLAN_NOT_FOUND },
        ]);
      }
      if (planCheck.archivedIds.length > 0) {
        throw createAppError(422, Messages.CLASS_PLAN_ARCHIVED, AppErrors.VALIDATION_ERROR.code, [
          { field: 'eligiblePlanIds', message: Messages.CLASS_PLAN_ARCHIVED },
        ]);
      }
    }
  }

  if (dedupedCoachIds.length > 0) {
    const coachCheck = await validateCoachIds(dedupedCoachIds);
    if (!coachCheck.valid) {
      throw createAppError(422, Messages.CLASS_COACH_NOT_FOUND, AppErrors.VALIDATION_ERROR.code, [
        { field: 'coachIds', message: Messages.CLASS_COACH_NOT_FOUND },
      ]);
    }
  }

  const existing = await findActiveByName(data.name);
  if (existing) {
    throw createAppError(AppErrors.CLASS_DUPLICATE_NAME);
  }

  try {
    const created = await createClassWithPlans({
      data,
      planIds: dedupedPlanIds,
      coachIds: dedupedCoachIds,
    });
    return toClassResponse(created);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw createAppError(AppErrors.CLASS_DUPLICATE_NAME);
    }
    throw err;
  }
};

const updateClass = async ({ classRecord, payload }) => {
  // If class is inactive (deactivated or archived) -> 409 CLASS_INACTIVE
  if (classRecord.status !== 'ACTIVE' && classRecord.active !== true) {
    throw createAppError(AppErrors.CLASS_INACTIVE);
  }

  const { version, coachIds, ...data } = payload;

  if (version !== undefined && version !== null) {
    if (version !== classRecord.version) {
      throw createAppError(AppErrors.CLASS_VERSION_CONFLICT);
    }
  }

  if (data.name && data.name.trim().toLowerCase() !== classRecord.name.trim().toLowerCase()) {
    const existing = await findActiveByName(data.name);
    if (existing && existing.id !== classRecord.id) {
      throw createAppError(AppErrors.CLASS_DUPLICATE_NAME);
    }
  }

  if (coachIds !== undefined && coachIds.length > 0) {
    const coachCheck = await validateCoachIds(coachIds);
    if (!coachCheck.valid) {
      throw createAppError(422, Messages.CLASS_COACH_NOT_FOUND, AppErrors.VALIDATION_ERROR.code, [
        { field: 'coachIds', message: Messages.CLASS_COACH_NOT_FOUND },
      ]);
    }
  }

  try {
    const result = await repositoryUpdateClass({
      id: classRecord.id,
      data,
      coachIds,
      version,
    });

    if (result.conflict) {
      throw createAppError(AppErrors.CLASS_VERSION_CONFLICT);
    }

    return toClassResponse(result.classRecord);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw createAppError(AppErrors.CLASS_DUPLICATE_NAME);
    }
    throw err;
  }
};

const deactivateClass = async ({ classRecord }) => {
  if (classRecord.status === 'DEACTIVATED' || classRecord.active === false) {
    return { id: classRecord.id, status: 'deactivated', active: false };
  }

  const bookedSessionsCount = await classRepository.countFutureBookedSessions(classRecord.id);

  if (bookedSessionsCount > 0) {
    throw createAppError(
      AppErrors.CLASS_HAS_FUTURE_BOOKINGS,
      Messages.CLASS_HAS_FUTURE_BOOKINGS,
      AppErrors.CLASS_HAS_FUTURE_BOOKINGS.code,
      { sessionCount: bookedSessionsCount },
    );
  }

  return repositoryDeactivateClass(classRecord.id);
};

const activateClass = async ({ classRecord }) => {
  if (classRecord.status === 'ACTIVE' && classRecord.active === true) {
    return { id: classRecord.id, status: 'active', active: true };
  }

  return repositoryActivateClass(classRecord.id);
};

const archiveClass = async ({ classRecord }) => {
  if (classRecord.status === 'ARCHIVED') {
    return { id: classRecord.id, status: 'archived', active: false };
  }

  const bookedSessionsCount = await classRepository.countFutureBookedSessions(classRecord.id);

  if (bookedSessionsCount > 0) {
    throw createAppError(
      AppErrors.CLASS_HAS_FUTURE_BOOKINGS,
      Messages.CLASS_HAS_FUTURE_BOOKINGS,
      AppErrors.CLASS_HAS_FUTURE_BOOKINGS.code,
      { sessionCount: bookedSessionsCount },
    );
  }

  return repositoryArchiveClass(classRecord.id);
};

const updateClassEligibility = async ({ classRecord, planIds = [] }) => {
  if (classRecord.status !== 'ACTIVE' && classRecord.active !== true) {
    throw createAppError(AppErrors.CLASS_INACTIVE);
  }

  const dedupedPlanIds = Array.from(new Set(planIds));

  if (classRecord.visibility === ClassVisibility.PUBLIC && dedupedPlanIds.length === 0) {
    throw createAppError(
      422,
      Messages.CLASS_PUBLIC_REQUIRES_PLANS,
      AppErrors.VALIDATION_ERROR.code,
      [{ field: 'planIds', message: Messages.CLASS_PUBLIC_REQUIRES_PLANS }],
    );
  }

  if (dedupedPlanIds.length > 0) {
    const planCheck = await validatePlanIds(dedupedPlanIds);
    if (!planCheck.valid) {
      if (planCheck.unknownIds.length > 0) {
        throw createAppError(422, Messages.CLASS_PLAN_NOT_FOUND, AppErrors.VALIDATION_ERROR.code, [
          { field: 'planIds', message: Messages.CLASS_PLAN_NOT_FOUND },
        ]);
      }
      if (planCheck.archivedIds.length > 0) {
        throw createAppError(422, Messages.CLASS_PLAN_ARCHIVED, AppErrors.VALIDATION_ERROR.code, [
          { field: 'planIds', message: Messages.CLASS_PLAN_ARCHIVED },
        ]);
      }
    }
  }

  const updatedPlanIds = await replaceEligiblePlans({
    classId: classRecord.id,
    planIds: dedupedPlanIds,
  });

  return {
    classId: classRecord.id,
    planIds: updatedPlanIds,
  };
};

module.exports = {
  listClasses,
  getClass,
  createClass,
  updateClass,
  deactivateClass,
  activateClass,
  archiveClass,
  updateClassEligibility,
  buildClassWhere,
};
