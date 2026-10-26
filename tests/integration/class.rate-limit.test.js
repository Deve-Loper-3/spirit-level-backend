const request = require('supertest');
const express = require('express');
const { createPlanLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const errorHandler = require('../../src/middlewares/errorHandler.middleware');
const { authorize } = require('../../src/middlewares/authorize.middleware');
const { Role } = require('../../src/constants/roles');

describe('Class Rate Limiter & Order of Execution', () => {
  it('returns 429 TOO_MANY_REQUESTS with standard envelope when limit is exceeded', async () => {
    const testApp = express();
    testApp.use(express.json());
    const strictLimiter = createPlanLimiter({ max: 1, windowMs: 60000 });
    testApp.get('/test-class-read', strictLimiter, (_req, res) =>
      res.status(200).json({ success: true }),
    );
    testApp.use(errorHandler);

    const res1 = await request(testApp).get('/test-class-read');
    expect(res1.status).toBe(200);

    const res2 = await request(testApp).get('/test-class-read');
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe('TOO_MANY_REQUESTS');
    expect(res2.body.success).toBe(false);
  });

  it('rate limiter runs AFTER authorize: 403 requests do not consume limiter quota', async () => {
    const testApp = express();
    testApp.use(express.json());

    // Mock authenticate placing user on req
    let currentUserRole = Role.MEMBER;
    testApp.use((req, _res, next) => {
      req.user = { id: 'u1', role: currentUserRole };
      next();
    });

    const strictLimiter = createPlanLimiter({ max: 1, windowMs: 60000 });

    // Middleware order: authorize -> limiter -> handler
    testApp.post(
      '/test-protected-class',
      authorize(Role.ADMIN, Role.OWNER),
      strictLimiter,
      (_req, res) => res.status(200).json({ success: true }),
    );
    testApp.use(errorHandler);

    // 1st request with Member role -> 403 (should not hit limiter)
    currentUserRole = Role.MEMBER;
    const resForbidden1 = await request(testApp).post('/test-protected-class');
    expect(resForbidden1.status).toBe(403);

    // 2nd request with Member role -> 403 (should not hit limiter)
    const resForbidden2 = await request(testApp).post('/test-protected-class');
    expect(resForbidden2.status).toBe(403);

    // Now switch to Admin role -> should succeed because quota (max: 1) was not consumed by 403s
    currentUserRole = Role.ADMIN;
    const resSuccess = await request(testApp).post('/test-protected-class');
    expect(resSuccess.status).toBe(200);

    // Next request with Admin role now hits the limit -> 429
    const resRateLimited = await request(testApp).post('/test-protected-class');
    expect(resRateLimited.status).toBe(429);
  });
});
