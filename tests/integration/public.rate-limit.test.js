const request = require('supertest');
const express = require('express');
const {
  publicLimiter,
  createAuthLimiter,
} = require('../../src/middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../../src/middlewares/methodNotAllowed.middleware');
const notFound = require('../../src/middlewares/notFound.middleware');
const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const { createApp } = require('../../src/app');

describe('public (no user) rate limiting', () => {
  it('GET /health stays unlimited and carries no rate-limit headers', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it.each(['/health/ready', '/api-docs/openapi.json', '/api-docs/openapi.yaml', '/nope'])(
    'GET %s goes through the public limiter',
    async (path) => {
      const res = await request(createApp()).get(path);
      expect(res.headers['ratelimit-limit']).toBeDefined();
    },
  );

  it('405 handlers are limited, and still answer 405 with Allow', async () => {
    const app = express();
    app.all('/thing', methodNotAllowed(['GET']));
    app.use(errorHandler);
    const res = await request(app).post('/thing');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  it('answers 429 TOO_MANY_REQUESTS in the standard envelope once the limit is used up', async () => {
    const app = express();
    const tiny = createAuthLimiter({ max: 1, windowMs: 60000 });
    app.use(tiny, notFound);
    app.use(errorHandler);
    await request(app).get('/a');
    const res = await request(app).get('/b');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, code: 'TOO_MANY_REQUESTS' });
  });

  it('exports one shared publicLimiter', () => {
    expect(typeof publicLimiter).toBe('function');
  });
});
