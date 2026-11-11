const prisma = require('../config/prisma');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const { Role } = require('../constants/roles');
const { CoachStatus } = require('../constants/coach');
const { AccountStatus } = require('../constants/status');
const { AppointmentState } = require('../constants/appointment');
const { Messages } = require('../constants/messages');
const repo = require('../repositories/appointment.repository');
const typeRepo = require('../repositories/appointmentType.repository');
const { lockCoachSchedule } = require('../repositories/coachSchedule.repository');
const { findCoachById, findCoachByUserId } = require('../repositories/coach.repository');
const { toAppointmentResponse } = require('../repositories/appointment.mapper');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { assertIntervalAssignable } = require('./coachSchedule.service');
const { assertManager, isCoachManager } = require('./coach.access');
const { buildPagination } = require('../utils/pagination.util');

// Lock + conflict check + write + audit is several round trips on the remote database.
const TX_OPTIONS = Object.freeze({ maxWait: 15000, timeout: 30000 });

const MS_PER_MINUTE = 60 * 1000;

const validationError = (field, message) =>
  createAppError(AppErrors.VALIDATION_ERROR.statusCode, message, AppErrors.VALIDATION_ERROR.code, [
    { field, message },
  ]);

// ==========================================
// Rules (pure, so they are unit tested without a database)
// ==========================================

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * MS_PER_MINUTE);

// An appointment starts in the future. The comparison is between instants, so the facility
// timezone does not matter here.
const assertStartInFuture = (startAt, now) => {
  if (startAt.getTime() <= now.getTime()) {
    throw validationError('startAt', Messages.APPOINTMENT_START_IN_PAST);
  }
};

// The end and the buffer snapshots of a new booking. The buffers are COPIED from the type at
// booking time, so later edits of the type never change this appointment.
const buildBookingTimes = (type, startAt) => ({
  startAt,
  endAt: addMinutes(startAt, type.durationMin),
  bufferBeforeMin: type.bufferBeforeMin,
  bufferAfterMin: type.bufferAfterMin,
});

// Cancel: only a BOOKED appointment that has not started yet. (Simplest rule: startAt <= now
// means started or over. Cancelling a running or finished appointment is history, not a cancel.)
const assertCancellable = (appointment, now) => {
  if (appointment.state === AppointmentState.CANCELLED) {
    throw createAppError(AppErrors.APPOINTMENT_ALREADY_CANCELLED);
  }
  if (appointment.startAt.getTime() <= now.getTime()) {
    throw createAppError(AppErrors.APPOINTMENT_PAST_IMMUTABLE);
  }
};

// ==========================================
// Who may see what
// ==========================================

// Resolves the caller's reading scope. A manager sees everything. A coach is limited to their
// own appointments and a member to their own; asking for someone else's is a 403 (same pattern as
// the availability and leave endpoints). Any other role is 403.
const resolveReadScope = async (caller) => {
  if (isCoachManager(caller.role)) return { kind: 'manager' };
  if (caller.role === Role.COACH) {
    const coach = await findCoachByUserId(caller.id);
    if (!coach) throw createAppError(AppErrors.FORBIDDEN);
    return { kind: 'coach', coachId: coach.id };
  }
  if (caller.role === Role.MEMBER) return { kind: 'member', memberId: caller.id };
  throw createAppError(AppErrors.FORBIDDEN);
};

const scopeFilters = (scope, query) => {
  if (scope.kind === 'coach') {
    if (query.coachId && query.coachId !== scope.coachId) throw createAppError(AppErrors.FORBIDDEN);
    return { coachId: scope.coachId, memberId: query.memberId };
  }
  if (scope.kind === 'member') {
    if (query.memberId && query.memberId !== scope.memberId) {
      throw createAppError(AppErrors.FORBIDDEN);
    }
    return { coachId: query.coachId, memberId: scope.memberId };
  }
  return { coachId: query.coachId, memberId: query.memberId };
};

const assertCanRead = (scope, appointment) => {
  if (scope.kind === 'manager') return;
  const own =
    scope.kind === 'coach'
      ? appointment.coachId === scope.coachId
      : appointment.memberId === scope.memberId;
  if (!own) throw createAppError(AppErrors.FORBIDDEN);
};

// ==========================================
// Use cases
// ==========================================

const listAppointments = async ({ caller, query }) => {
  const scope = await resolveReadScope(caller);
  const { coachId, memberId } = scopeFilters(scope, query);
  const { page, limit, state, from, to } = query;
  const { rows, total } = await repo.listAppointments({
    coachId,
    memberId,
    state,
    from,
    to,
    page,
    limit,
  });
  return {
    data: rows.map(toAppointmentResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getAppointment = async ({ caller, appointmentId }) => {
  const scope = await resolveReadScope(caller);
  const appointment = await repo.findAppointmentById(appointmentId);
  if (!appointment) throw createAppError(AppErrors.APPOINTMENT_NOT_FOUND);
  assertCanRead(scope, appointment);
  return toAppointmentResponse(appointment);
};

// Reads the three things a booking refers to. Unknown id = 404, known but not bookable = 409.
const loadBookingParties = async ({ coachId, memberId, appointmentTypeId }) => {
  const [coach, member, type] = await Promise.all([
    findCoachById(coachId),
    repo.findUserForBooking(memberId),
    typeRepo.findAppointmentTypeById(appointmentTypeId),
  ]);
  if (!coach) throw createAppError(AppErrors.COACH_NOT_FOUND);
  if (!member || member.role !== Role.MEMBER) throw createAppError(AppErrors.MEMBER_NOT_FOUND);
  if (!type) throw createAppError(AppErrors.APPOINTMENT_TYPE_NOT_FOUND);
  if (coach.status !== CoachStatus.ACTIVE) throw createAppError(AppErrors.COACH_INACTIVE);
  if (member.status !== AccountStatus.ACTIVE) throw createAppError(AppErrors.MEMBER_NOT_ACTIVE);
  if (!type.isActive) throw createAppError(AppErrors.APPOINTMENT_TYPE_INACTIVE);
  return { coach, member, type };
};

// Managers only (booking is done on behalf of the member). One transaction: the coach's schedule
// lock, the conflict check (assertIntervalAssignable, the S7 seam) and the insert + audit.
const createAppointment = async ({ actor, input, meta, now = new Date() }) => {
  assertManager(actor);
  assertStartInFuture(input.startAt, now);
  const { member, type } = await loadBookingParties(input);
  const times = buildBookingTimes(type, input.startAt);

  const created = await prisma.$transaction(async (tx) => {
    await lockCoachSchedule(input.coachId, tx);
    await assertIntervalAssignable({ coachId: input.coachId, ...times }, tx);
    const row = await repo.createAppointment(
      {
        coachId: input.coachId,
        memberId: input.memberId,
        appointmentTypeId: input.appointmentTypeId,
        ...times,
      },
      tx,
    );
    await createAuditLog(tx, {
      userId: input.memberId,
      action: AuditAction.APPOINTMENT_CREATED,
      email: member.email,
      actorId: actor.id,
      actorRole: actor.role,
      details: {
        appointmentId: row.id,
        coachId: input.coachId,
        memberId: input.memberId,
        appointmentTypeId: input.appointmentTypeId,
        startAt: times.startAt.toISOString(),
        endAt: times.endAt.toISOString(),
      },
      meta,
    });
    return row;
  }, TX_OPTIONS);

  return toAppointmentResponse(created);
};

// Managers only. BOOKED -> CANCELLED, cancelledAt set, version + 1, audit, one transaction. The
// schedule lock of the appointment's coach serializes it with bookings and with a second cancel.
// No credit, notification or other side effect (appointments have none in this ticket).
const cancelAppointment = async ({ actor, appointmentId, meta, now = new Date() }) => {
  assertManager(actor);
  const known = await repo.findAppointmentById(appointmentId);
  if (!known) throw createAppError(AppErrors.APPOINTMENT_NOT_FOUND);

  const cancelled = await prisma.$transaction(async (tx) => {
    await lockCoachSchedule(known.coachId, tx);
    const stored = await repo.findAppointmentById(appointmentId, tx);
    if (!stored) throw createAppError(AppErrors.APPOINTMENT_NOT_FOUND);
    assertCancellable(stored, now);

    const row = await repo.markAppointmentCancelled(appointmentId, now, tx);
    await createAuditLog(tx, {
      userId: stored.memberId,
      action: AuditAction.APPOINTMENT_CANCELLED,
      actorId: actor.id,
      actorRole: actor.role,
      details: {
        appointmentId,
        coachId: stored.coachId,
        memberId: stored.memberId,
        startAt: stored.startAt.toISOString(),
        endAt: stored.endAt.toISOString(),
      },
      meta,
    });
    return row;
  }, TX_OPTIONS);

  return toAppointmentResponse(cancelled);
};

module.exports = {
  listAppointments,
  getAppointment,
  createAppointment,
  cancelAppointment,
  assertStartInFuture,
  buildBookingTimes,
  assertCancellable,
  scopeFilters,
};
