const { Prisma } = require('@prisma/client');
const {
  isUniqueConstraintError,
  isRecordNotFoundError,
} = require('../../src/utils/prismaError.util');

const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '6.0.0' });

describe('prismaError.util', () => {
  it('recognises P2002 as a unique violation, from Prisma or a plain object with the code', () => {
    expect(isUniqueConstraintError(prismaError('P2002'))).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
  });

  it('recognises P2025 as a missing record', () => {
    expect(isRecordNotFoundError(prismaError('P2025'))).toBe(true);
    expect(isRecordNotFoundError({ code: 'P2025' })).toBe(true);
  });

  it('does not mix the two codes up', () => {
    expect(isUniqueConstraintError(prismaError('P2025'))).toBe(false);
    expect(isRecordNotFoundError(prismaError('P2002'))).toBe(false);
  });

  it.each([new Error('x'), null, undefined, 'P2002'])('returns false for %p', (err) => {
    expect(isUniqueConstraintError(err)).toBe(false);
    expect(isRecordNotFoundError(err)).toBe(false);
  });
});
