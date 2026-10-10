const express = require('express');
const request = require('supertest');
const { createAuthLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');

describe('rateLimiter.middleware', () => {
  it('returns 429 when request limit is exceeded using a tiny max', async () => {
    const app = express();
    const testLimiter = createAuthLimiter({ max: 2, windowMs: 60000 });

    app.get('/test-limit', testLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'ok' });
    });
    app.use(errorHandler);

    // Request 1: allowed
    const res1 = await request(app).get('/test-limit');
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    // Request 2: allowed
    const res2 = await request(app).get('/test-limit');
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);

    // Request 3: blocked by rate limiter
    const res3 = await request(app).get('/test-limit');
    expect(res3.status).toBe(AppErrors.TOO_MANY_REQUESTS.statusCode);
    expect(res3.body.success).toBe(false);
    expect(res3.body.message).toBe(Messages.TOO_MANY_REQUESTS);
  });

  it('default limiter allows multiple requests in test environment without blocking', async () => {
    const app = express();
    const defaultLimiter = createAuthLimiter();

    app.get('/test-default', defaultLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'ok' });
    });
    app.use(errorHandler);

    // Send 15 requests (exceeding default prod limit of 10) to verify test mode does not block
    for (let i = 0; i < 15; i += 1) {
      const res = await request(app).get('/test-default');
      expect(res.status).toBe(200);
    }
  });
});
