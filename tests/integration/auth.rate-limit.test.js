const request = require('supertest');
const { AppErrors } = require('../../src/constants/errors');

describe('Auth routes rate limiting (integration)', () => {
  const originalEnvMax = process.env.RATE_LIMIT_MAX;
  const originalEnvWindow = process.env.RATE_LIMIT_WINDOW_MS;
  const originalRefreshMax = process.env.REFRESH_RATE_LIMIT_MAX;
  const originalRefreshWindow = process.env.REFRESH_RATE_LIMIT_WINDOW_MS;

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

    if (originalRefreshMax === undefined) {
      delete process.env.REFRESH_RATE_LIMIT_MAX;
    } else {
      process.env.REFRESH_RATE_LIMIT_MAX = originalRefreshMax;
    }

    if (originalRefreshWindow === undefined) {
      delete process.env.REFRESH_RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.REFRESH_RATE_LIMIT_WINDOW_MS = originalRefreshWindow;
    }
  });

  const getIsolatedApp = (refreshMax = '2') => {
    let appInstance;
    jest.isolateModules(() => {
      process.env.RATE_LIMIT_MAX = '2';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';
      process.env.REFRESH_RATE_LIMIT_MAX = refreshMax;
      process.env.REFRESH_RATE_LIMIT_WINDOW_MS = '60000';
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

  // Below the limit, refresh fails validation (400); logout needs authentication first (401).
  // No database is touched: the limiter runs before both.
  it.each([
    ['/api/v1/auth/refresh', 400],
    ['/api/v1/auth/logout', 401],
  ])(
    'POST %s returns 429 in the standard shape on the 3rd request when limit is 2',
    async (url, statusBelowLimit) => {
      const app = getIsolatedApp();

      expect((await request(app).post(url).send({})).status).toBe(statusBelowLimit);
      expect((await request(app).post(url).send({})).status).toBe(statusBelowLimit);

      const res3 = await request(app).post(url).send({});
      expect(res3.status).toBe(AppErrors.TOO_MANY_REQUESTS.statusCode);
      expect(res3.body).toEqual({
        success: false,
        message: AppErrors.TOO_MANY_REQUESTS.message,
      });
    },
  );

  it('refresh and logout share one counter, separate from the login counter', async () => {
    const app = getIsolatedApp();

    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(429);
    expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(429);
    // The login counter is untouched: still reaches validation instead of being rate limited.
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
  });

  it('the refresh limit comes from REFRESH_RATE_LIMIT_MAX, not from the login limit', async () => {
    const app = getIsolatedApp('4'); // login limit stays 2

    for (let i = 0; i < 4; i += 1) {
      expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(400);
    }
    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(429);

    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(429);
  });
});
