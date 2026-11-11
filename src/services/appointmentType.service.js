const prisma = require('../config/prisma');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AuditAction } = require('../constants/audit');
const repo = require('../repositories/appointmentType.repository');
const { toAppointmentTypeResponse } = require('../repositories/appointmentType.mapper');
const { createAuditLog } = require('../repositories/audit-log.repository');
const { assertManager, isCoachManager } = require('./coach.access');
const { isUniqueConstraintError } = require('../utils/prismaError.util');
const { buildPagination } = require('../utils/pagination.util');

const TYPE_FIELDS = ['name', 'durationMin', 'bufferBeforeMin', 'bufferAfterMin', 'isActive'];

const pickTypeFields = (row) => Object.fromEntries(TYPE_FIELDS.map((field) => [field, row[field]]));

// Only an ACTIVE type reserves its name (same rule as the partial unique index in the database).
const assertNameFree = async ({ name, excludeId }, client) => {
  const clash = await repo.findActiveTypeByName({ name, excludeId }, client);
  if (clash) throw createAppError(AppErrors.APPOINTMENT_TYPE_NAME_TAKEN);
};

// The database index is the last line of defence when two requests race past the check above.
const mapNameRace = (err) =>
  isUniqueConstraintError(err) ? createAppError(AppErrors.APPOINTMENT_TYPE_NAME_TAKEN) : err;

// Managers see active and inactive types and may filter; every other role sees active types only
// (a sent `isActive` filter is overridden), so an inactive type is never offered to a client.
const listAppointmentTypes = async ({ caller, query }) => {
  const { page, limit } = query;
  const isActive = isCoachManager(caller.role) ? query.isActive : true;
  const { rows, total } = await repo.listAppointmentTypes({ isActive, page, limit });
  return {
    data: rows.map(toAppointmentTypeResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const createAppointmentType = async ({ actor, input, meta }) => {
  assertManager(actor);
  if (input.isActive) await assertNameFree({ name: input.name });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await repo.createAppointmentType(input, tx);
      await createAuditLog(tx, {
        action: AuditAction.APPOINTMENT_TYPE_CREATED,
        actorId: actor.id,
        actorRole: actor.role,
        details: { appointmentTypeId: row.id, ...pickTypeFields(row) },
        meta,
      });
      return row;
    });
    return toAppointmentTypeResponse(created);
  } catch (err) {
    throw mapNameRace(err);
  }
};

// Editing a type never touches existing appointments: they hold their own snapshots of the buffers.
const updateAppointmentType = async ({ actor, typeId, patch, meta }) => {
  assertManager(actor);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const stored = await repo.findAppointmentTypeById(typeId, tx);
      if (!stored) throw createAppError(AppErrors.APPOINTMENT_TYPE_NOT_FOUND);

      const changed = Object.keys(patch).filter((field) => patch[field] !== stored[field]);
      if (changed.length === 0) return stored; // nothing to write, nothing to audit

      const merged = { ...stored, ...patch };
      const nameClaimed = changed.includes('name') || changed.includes('isActive');
      if (merged.isActive && nameClaimed) {
        await assertNameFree({ name: merged.name, excludeId: typeId }, tx);
      }

      const row = await repo.updateAppointmentType(
        typeId,
        Object.fromEntries(changed.map((field) => [field, patch[field]])),
        tx,
      );
      await createAuditLog(tx, {
        action: AuditAction.APPOINTMENT_TYPE_UPDATED,
        actorId: actor.id,
        actorRole: actor.role,
        details: {
          appointmentTypeId: typeId,
          changed,
          before: Object.fromEntries(changed.map((field) => [field, stored[field]])),
          after: Object.fromEntries(changed.map((field) => [field, row[field]])),
        },
        meta,
      });
      return row;
    });
    return toAppointmentTypeResponse(updated);
  } catch (err) {
    throw mapNameRace(err);
  }
};

module.exports = { listAppointmentTypes, createAppointmentType, updateAppointmentType };
