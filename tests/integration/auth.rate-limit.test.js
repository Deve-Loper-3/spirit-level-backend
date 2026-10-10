const request = require('supertest');
const { AppErrors } = require('../../src/constants/errors');

describe('Auth routes rate limiting (integration)', () => {
  const originalEnvMax = process.env.RATE_LIMIT_MAX;
  const originalEnvWindow = process.env.RATE_LIMIT_WINDOW_MS;

  afterAll(() => {
    if (originalEnvMax === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = originalEnvMax;
    }

    if (originalEnvWindow === undefined) {
      delete process.env.RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.RATE_LIMIT_WINDOW_MS = originalEnvWindow;
    }
  });

  const getIsolatedApp = () => {
    let appInstance;
    jest.isolateModules(() => {
      process.env.RATE_LIMIT_MAX = '2';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';
      const { createApp } = require('../../src/app');
      appInstance = createApp();
    });
    return appInstance;
  };

  it('POST /api/v1/auth/register/complete returns 429 on the 3rd request when limit is 2', async () => {
    const app = getIsolatedApp();

    // Requests 1 & 2: invalid payload (no DB write), passes rate limiter but fails validation
    const res1 = await request(app).post('/api/v1/auth/register/complete').send({});
    expect(res1.status).toBe(400);

    const res2 = await request(app).post('/api/v1/auth/register/complete').send({});
    expect(res2.status).toBe(400);

    // Request 3: blocked by rate limiter before validation
    const res3 = await request(app).post('/api/v1/auth/register/complete').send({});
    expect(res3.status).toBe(AppErrors.TOO_MANY_REQUESTS.statusCode);
    expect(res3.body.success).toBe(false);
    expect(res3.body.message).toBe(AppErrors.TOO_MANY_REQUESTS.message);
  });

  it('POST /api/v1/auth/register returns 429 on the 3rd request when limit is 2', async () => {
    const app = getIsolatedApp();

    // Requests 1 & 2: invalid payload (no DB write), passes rate limiter but fails validation
    const res1 = await request(app).post('/api/v1/auth/register').send({});
    expect(res1.status).toBe(400);

    const res2 = await request(app).post('/api/v1/auth/register').send({});
    expect(res2.status).toBe(400);

    // Request 3: blocked by rate limiter before validation
    const res3 = await request(app).post('/api/v1/auth/register').send({});
    expect(res3.status).toBe(AppErrors.TOO_MANY_REQUESTS.statusCode);
    expect(res3.body.success).toBe(false);
    expect(res3.body.message).toBe(AppErrors.TOO_MANY_REQUESTS.message);
  });
});
