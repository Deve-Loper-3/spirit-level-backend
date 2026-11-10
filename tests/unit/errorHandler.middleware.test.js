const express = require('express');
const request = require('supertest');
const z = require('zod');
const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const notFound = require('../../src/middlewares/notFound.middleware');
const { createAppError } = require('../../src/errors/AppError');
const { AppErrors } = require('../../src/constants/errors');
const { Messages } = require('../../src/constants/messages');
const { sendError } = require('../../src/utils/apiResponse.util');

const buildApp = (route) => {
  const app = express();
  app.use(express.json());
  app.post('/test', route);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe('errorHandler code field', () => {
  it('sends the AppErrors code of an operational error', async () => {
    const app = buildApp((_req, _res, next) => next(createAppError(AppErrors.COACH_NOT_FOUND)));

    const res = await request(app).post('/test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: Messages.COACH_NOT_FOUND,
      code: 'COACH_NOT_FOUND',
    });
  });

  it('sends the 409 coach email code', async () => {
    const app = buildApp((_req, _res, next) =>
      next(createAppError(AppErrors.COACH_EMAIL_ALREADY_EXISTS)),
    );

    const res = await request(app).post('/test');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COACH_EMAIL_ALREADY_EXISTS');
  });

  it('sends VALIDATION_ERROR with the field errors for a ZodError', async () => {
    const app = buildApp((req, _res, next) => {
      const result = z.object({ name: z.string() }).safeParse(req.body);
      next(result.error);
    });

    const res = await request(app).post('/test').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: Messages.VALIDATION_FAILED,
      code: 'VALIDATION_ERROR',
    });
    expect(res.body.errors[0].field).toBe('name');
  });

  it('sends VALIDATION_ERROR for malformed JSON', async () => {
    const app = buildApp((_req, res) => res.sendStatus(204));

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ bad json');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('sends INTERNAL_SERVER_ERROR and hides the details of an unexpected error', async () => {
    const app = buildApp((_req, _res, next) => next(new Error('db password is hunter2')));

    const res = await request(app).post('/test');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: Messages.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('omits the generic APP_ERROR code of createAppError(status, message)', async () => {
    const app = buildApp((_req, _res, next) => next(createAppError(418, 'I am a teapot')));

    const res = await request(app).post('/test');

    expect(res.status).toBe(418);
    expect(res.body).toEqual({ success: false, message: 'I am a teapot' });
  });

  it('sends ROUTE_NOT_FOUND for an unmatched route', async () => {
    const app = buildApp((_req, res) => res.sendStatus(204));

    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('sendError', () => {
  const buildRes = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  it('adds code only when given and keeps the order message, code, errors', () => {
    const res = buildRes();

    sendError(res, { statusCode: 400, message: 'm', code: 'C', errors: [{ field: 'f' }] });

    expect(Object.keys(res.json.mock.calls[0][0])).toEqual([
      'success',
      'message',
      'code',
      'errors',
    ]);
  });

  it('leaves code out when it is not given', () => {
    const res = buildRes();

    sendError(res, { statusCode: 400, message: 'm' });

    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'm' });
  });
});

describe('errorHandler status and code of framework and Prisma errors', () => {
  const { Prisma } = require('@prisma/client');
  const prismaError = (code) =>
    new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '6.0.0' });

  it('answers a body over the limit with 413 PAYLOAD_TOO_LARGE and a code', async () => {
    const app = express();
    app.use(express.json({ limit: '1kb' }));
    app.post('/test', (_req, res) => res.sendStatus(204));
    app.use(errorHandler);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(5000) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      success: false,
      message: Messages.PAYLOAD_TOO_LARGE,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('uses the constant message for malformed JSON', async () => {
    const app = buildApp((_req, res) => res.sendStatus(204));
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ bad json');
    expect(res.body.message).toBe(Messages.MALFORMED_JSON);
  });

  it('an unmapped unique violation is a generic 409, not "User already exists"', async () => {
    const app = buildApp((_req, _res, next) => next(prismaError('P2002')));
    const res = await request(app).post('/test');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: Messages.RESOURCE_ALREADY_EXISTS,
      code: 'RESOURCE_ALREADY_EXISTS',
    });
    expect(res.body.message).not.toMatch(/user/i);
  });

  it('an unmapped missing-record error is a 404, not a 500', async () => {
    const app = buildApp((_req, _res, next) => next(prismaError('P2025')));
    const res = await request(app).post('/test');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('the 404 fallback has a fixed message that does not echo the URL or query string', async () => {
    const app = buildApp((_req, res) => res.sendStatus(204));
    const res = await request(app).get('/nope?token=secret');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: Messages.ROUTE_NOT_FOUND,
      code: 'ROUTE_NOT_FOUND',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
