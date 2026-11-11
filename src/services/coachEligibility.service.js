const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const repo = require('../repositories/coachSchedule.repository');
const typeRepo = require('../repositories/appointmentType.repository');
const { checkCoachesForInterval } = require('./coachSchedule.service');

const MS_PER_MINUTE = 60 * 1000;

// Resolves the interval of the question. With an appointment type, the end is startAt + the type's
// duration and the buffers are the type's; with an explicit endAt there are no buffers. An unknown
// type is 404, an inactive one 409 (it could not be booked either).
const resolveInterval = async ({ startAt, endAt, appointmentTypeId }) => {
  if (!appointmentTypeId) return { startAt, endAt, bufferBeforeMin: 0, bufferAfterMin: 0 };
  const type = await typeRepo.findAppointmentTypeById(appointmentTypeId);
  if (!type) throw createAppError(AppErrors.APPOINTMENT_TYPE_NOT_FOUND);
  if (!type.isActive) throw createAppError(AppErrors.APPOINTMENT_TYPE_INACTIVE);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + type.durationMin * MS_PER_MINUTE),
    bufferBeforeMin: type.bufferBeforeMin,
    bufferAfterMin: type.bufferAfterMin,
  };
};

const toEligibility = (coach, conflict) => ({
  coachId: coach.id,
  fullName: coach.user.fullName,
  eligible: conflict === null,
  conflict:
    conflict === null
      ? null
      : {
          type: conflict.type,
          message: conflict.message,
          conflictingItem: conflict.conflictingItem,
        },
});

// Every ACTIVE coach with whether they could take the interval and, if not, the first reason. Read
// only: it never writes and takes no lock, so the answer can be stale by the time the caller saves
// (the save itself re-checks under the coach's lock). The whole list costs a fixed number of queries
// (coaches, type, then one per rule source), not one per coach.
const listEligibleCoaches = async ({ query }) => {
  const [coaches, interval] = await Promise.all([
    repo.findActiveCoachesForPicker(),
    resolveInterval(query),
  ]);
  const conflicts = await checkCoachesForInterval({
    coachIds: coaches.map((coach) => coach.id),
    ...interval,
    excludeSessionId: query.excludeSessionId,
    excludeAppointmentId: query.excludeAppointmentId,
  });
  return coaches.map((coach) => toEligibility(coach, conflicts.get(coach.id) ?? null));
};

module.exports = { listEligibleCoaches, toEligibility, resolveInterval };
