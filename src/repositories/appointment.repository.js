const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AppointmentState } = require('../constants/appointment');
const { toSkipTake } = require('../utils/pagination.util');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

// Names come from one join per relation inside the same query, so a page of any size is a fixed
// number of queries (no query per row).
const APPOINTMENT_SELECT = {
  id: true,
  coachId: true,
  memberId: true,
  appointmentTypeId: true,
  startAt: true,
  endAt: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  state: true,
  cancelledAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  coach: { select: { user: { select: { fullName: true } } } },
  member: { select: { fullName: true } },
  appointmentType: { select: { name: true } },
};

const findAppointmentById = (id, client = prisma) =>
  client.appointment.findUnique({ where: { id }, select: APPOINTMENT_SELECT });

// One page sorted by start time (id breaks ties). `from` is inclusive, `to` exclusive, both on startAt.
const listAppointments = async (
  { coachId, memberId, state, from, to, page, limit },
  client = prisma,
) => {
  const where = {
    ...(coachId && { coachId }),
    ...(memberId && { memberId }),
    ...(state && { state }),
    ...((from || to) && { startAt: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
  };
  const [rows, total] = await Promise.all([
    client.appointment.findMany({
      where,
      select: APPOINTMENT_SELECT,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      ...toSkipTake({ page, limit }),
    }),
    client.appointment.count({ where }),
  ]);
  return { rows, total };
};

const createAppointment = (data, client = prisma) =>
  client.appointment.create({
    data: { id: crypto.randomUUID(), state: AppointmentState.BOOKED, version: 1, ...data },
    select: APPOINTMENT_SELECT,
  });

const markAppointmentCancelled = (id, cancelledAt, client = prisma) =>
  client.appointment.update({
    where: { id },
    data: { state: AppointmentState.CANCELLED, cancelledAt, version: { increment: 1 } },
    select: APPOINTMENT_SELECT,
  });

// The member of a booking: a plain user row (members are `User` rows with role MEMBER).
const findUserForBooking = (id, client = prisma) =>
  client.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true, email: true },
  });

module.exports = {
  findAppointmentById,
  listAppointments,
  createAppointment,
  markAppointmentCancelled,
  findUserForBooking,
};
