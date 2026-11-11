const crypto = require('crypto');
const prisma = require('../config/prisma');
const { toSkipTake } = require('../utils/pagination.util');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

const TYPE_SELECT = {
  id: true,
  name: true,
  durationMin: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const findAppointmentTypeById = (id, client = prisma) =>
  client.appointmentType.findUnique({ where: { id }, select: TYPE_SELECT });

// One page sorted by name (id breaks ties). `isActive` undefined = both. Count and page run together.
const listAppointmentTypes = async ({ isActive, page, limit }, client = prisma) => {
  const where = isActive === undefined ? {} : { isActive };
  const [rows, total] = await Promise.all([
    client.appointmentType.findMany({
      where,
      select: TYPE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...toSkipTake({ page, limit }),
    }),
    client.appointmentType.count({ where }),
  ]);
  return { rows, total };
};

// An ACTIVE type with this name, ignoring case (names are stored trimmed). Mirrors the partial
// unique index `appointment_types_name_active_key`, which stays the last line of defence.
const findActiveTypeByName = ({ name, excludeId }, client = prisma) =>
  client.appointmentType.findFirst({
    where: {
      isActive: true,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });

const createAppointmentType = (data, client = prisma) =>
  client.appointmentType.create({
    data: { id: crypto.randomUUID(), ...data },
    select: TYPE_SELECT,
  });

const updateAppointmentType = (id, data, client = prisma) =>
  client.appointmentType.update({ where: { id }, data, select: TYPE_SELECT });

module.exports = {
  findAppointmentTypeById,
  listAppointmentTypes,
  findActiveTypeByName,
  createAppointmentType,
  updateAppointmentType,
};
