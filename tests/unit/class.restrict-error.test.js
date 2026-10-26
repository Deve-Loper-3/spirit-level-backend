const { Prisma } = require('@prisma/client');
const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const { isRestrictViolationError } = require('../../src/utils/prismaError.util');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');

describe('RESTRICT error mapping unit test', () => {
  it('identifies real Prisma error message containing violates RESTRICT setting', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed on the field: `class_sessions_classId_fkey` violates RESTRICT setting of foreign key constraint',
      {
        code: 'P2003',
        clientVersion: '6.19.3',
      },
    );

    expect(isRestrictViolationError(error)).toBe(true);
  });

  it('errorHandler maps RESTRICT error to 409 RESOURCE_IN_USE', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'violates RESTRICT setting of foreign key constraint',
      {
        code: 'P2003',
        clientVersion: '6.19.3',
      },
    );

    const req = { method: 'DELETE', originalUrl: '/api/v1/classes/123' };
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    const next = jest.fn();

    errorHandler(error, req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: Messages.RESOURCE_IN_USE,
      code: AppErrors.RESOURCE_IN_USE.code,
    });
  });
});
