const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');

jest.setTimeout(45000);

describe('Schedule Rate Limiting & Header Exposure', () => {
  const PREFIX = 'test_rate_';
  const testData = createTestData('rate_test');
  let app;
  let adminUser;
  let testClass;

  beforeAll(async () => {
    app = createApp();
    await deleteTestClasses(PREFIX);

    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Rate Tester' });
    testClass = await createTestClass(PREFIX, {
      name: `${PREFIX}RateClass`,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('exposes RateLimit and Location headers on session create', async () => {
    const res = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', bearerFor(adminUser))
      .set('Origin', 'http://localhost:3000')
      .send({
        classId: testClass.id,
        startAt: '2030-09-01T08:00:00.000Z',
        endAt: '2030-09-01T09:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBeDefined();
    // Verify Access-Control-Expose-Headers contains Location and RateLimit
    const exposedHeaders = res.headers['access-control-expose-headers'];
    expect(exposedHeaders).toBeDefined();
    expect(exposedHeaders.toLowerCase()).toContain('location');
    expect(exposedHeaders.toLowerCase()).toContain('ratelimit-limit');
  });

  it('attaches rate limiter and returns rate limit headers on GET /api/v1/sessions', async () => {
    const res = await request(app)
      .get('/api/v1/sessions?from=2030-09-01T00:00:00.000Z&to=2030-09-02T00:00:00.000Z')
      .set('Authorization', bearerFor(adminUser))
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    const exposedHeaders = res.headers['access-control-expose-headers'];
    expect(exposedHeaders).toBeDefined();
    expect(exposedHeaders.toLowerCase()).toContain('ratelimit-remaining');
  });
});
