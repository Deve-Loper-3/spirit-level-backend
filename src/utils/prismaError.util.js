const { Prisma } = require('@prisma/client');

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';

const hasPrismaCode = (err, code) =>
  (err instanceof Prisma.PrismaClientKnownRequestError && err.code === code) || err?.code === code;

const isUniqueConstraintError = (err) => hasPrismaCode(err, PRISMA_UNIQUE_VIOLATION);

const isRecordNotFoundError = (err) => hasPrismaCode(err, PRISMA_RECORD_NOT_FOUND);

module.exports = { isUniqueConstraintError, isRecordNotFoundError };
