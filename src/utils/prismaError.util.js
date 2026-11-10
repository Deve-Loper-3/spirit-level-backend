const { Prisma } = require('@prisma/client');
const { createAppError } = require('../errors/AppError');

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';

const hasPrismaCode = (err, code) =>
  (err instanceof Prisma.PrismaClientKnownRequestError && err.code === code) || err?.code === code;

const isUniqueConstraintError = (err) => hasPrismaCode(err, PRISMA_UNIQUE_VIOLATION);

const isRecordNotFoundError = (err) => hasPrismaCode(err, PRISMA_RECORD_NOT_FOUND);

// Runs a write that targets a row found a moment ago. If another request deleted the row in
// between, Prisma throws P2025; report it as the resource's own 404 instead of a 500.
const orNotFound = async (work, notFoundError) => {
  try {
    return await work();
  } catch (err) {
    if (isRecordNotFoundError(err)) throw createAppError(notFoundError);
    throw err;
  }
};

const RESTRICT_SETTING_SUBSTRING = 'violates RESTRICT setting';

const isRestrictViolationError = (err) =>
  Boolean(
    err && typeof err.message === 'string' && err.message.includes(RESTRICT_SETTING_SUBSTRING),
  );

module.exports = {
  isUniqueConstraintError,
  isRecordNotFoundError,
  isRestrictViolationError,
  orNotFound,
};
