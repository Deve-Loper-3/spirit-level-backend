const request = require('supertest');
const { createApp } = require('../../src/app');
const authService = require('../../src/services/auth.service');
const { createAppError } = require('../../src/errors/AppError');
const { AppErrors } = require('../../src/constants/errors');
const { Messages } = require('../../src/constants/messages');

jest.mock('../../src/services/auth.service');

const LOGIN_URL = '/api/v1/auth/login';
const USER_AGENT = 'jest-login-controller/1.0';

describe('POST /api/v1/auth/login (controller)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  it('responds 200 with the service result and passes the normalized body and request meta', async () => {
    const serviceResult = { user: { id: 'user-id' }, tokens: { accessToken: 'token' } };
    authService.loginWithPassword.mockResolvedValue(serviceResult);

    const res = await request(app)
      .post(LOGIN_URL)
      .set('User-Agent', USER_AGENT)
      .send({ email: '  Member@Test.INVALID ', password: 'Password123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: Messages.LOGIN_SUCCESS,
      data: serviceResult,
    });
    expect(authService.loginWithPassword).toHaveBeenCalledWith(
      { email: 'member@test.invalid', password: 'Password123' },
      { ipAddress: expect.any(String), userAgent: USER_AGENT },
    );
  });

  it('responds 400 and never calls the service for an invalid body', async () => {
    const res = await request(app).post(LOGIN_URL).send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
    expect(authService.loginWithPassword).not.toHaveBeenCalled();
  });

  it('maps a service AppError to its status and message', async () => {
    authService.loginWithPassword.mockRejectedValue(createAppError(AppErrors.INVALID_CREDENTIALS));

    const res = await request(app)
      .post(LOGIN_URL)
      .send({ email: 'member@test.invalid', password: 'Password123' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: Messages.INVALID_CREDENTIALS,
      code: AppErrors.INVALID_CREDENTIALS.code,
    });
  });
});
