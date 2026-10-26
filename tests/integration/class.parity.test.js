const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');
const { createTestPlan, deleteTestPlans } = require('../helpers/membershipPlan.helper');

jest.setTimeout(45000);

describe('Web + Mobile Parity across all Class Endpoints', () => {
  const PREFIX = 'test_slcls_parity_';
  const testData = createTestData('slcls_parity');
  let app;
  let adminUser;
  let memberUser;
  let plan;
  let sampleClass;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN });
    memberUser = await testData.createUser({ role: Role.MEMBER });
    plan = await createTestPlan(PREFIX);

    sampleClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Sample`,
      active: true,
      visibility: 'PUBLIC',
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const sendWithClientTypes = async (executeReq, compareBodies = true) => {
    // 1. Mobile-like client (no Origin, no Cookie, OkHttp UA)
    const mobileRes = await executeReq(
      request(app),
      {
        'User-Agent': 'okhttp/4.12.0',
      },
      'mobile',
    );

    // 2. Web-like browser client (Origin, browser UA, Cookie)
    const browserRes = await executeReq(
      request(app),
      {
        Origin: 'http://localhost:3000',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Cookie: 'session=junk_session_cookie; theme=dark',
      },
      'browser',
    );

    expect(mobileRes.status).toBe(browserRes.status);
    expect(mobileRes.headers['content-type']).toMatch(/application\/json/);
    expect(browserRes.headers['content-type']).toMatch(/application\/json/);
    if (compareBodies) {
      expect(mobileRes.body).toEqual(browserRes.body);
    } else {
      expect(Object.keys(mobileRes.body)).toEqual(Object.keys(browserRes.body));
      expect(Object.keys(mobileRes.body.data)).toEqual(Object.keys(browserRes.body.data));
    }

    return { mobileRes, browserRes };
  };

  it('proves parity on 200 SUCCESS (GET /api/v1/classes)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .get(`/api/v1/classes?search=${PREFIX}`)
        .set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
  });

  it('proves parity on 200 SUCCESS (GET /api/v1/classes/:id)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .get(`/api/v1/classes/${sampleClass.id}`)
        .set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(mobileRes.body.data.id).toBe(sampleClass.id);
  });

  it('proves parity on 201 SUCCESS (POST /api/v1/classes)', async () => {
    const { mobileRes, browserRes } = await sendWithClientTypes((req, headers, clientType) => {
      let r = req
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send({
          name: `${PREFIX}ParityCreated_${clientType}`,
          durationMin: 45,
          baseCapacity: 12,
          intensity: 3,
          visibility: 'public',
          eligiblePlanIds: [plan.id],
        });
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    }, false);

    expect(mobileRes.status).toBe(201);
    expect(browserRes.status).toBe(201);
    expect(mobileRes.body.success).toBe(true);
    expect(browserRes.body.success).toBe(true);
  });

  it('proves parity on 200 SUCCESS (PATCH /api/v1/classes/:id)', async () => {
    const { mobileRes, browserRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .patch(`/api/v1/classes/${sampleClass.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ description: 'Parity updated description' });
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    }, false);
    expect(mobileRes.status).toBe(200);
    expect(browserRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(browserRes.body.success).toBe(true);
    expect(mobileRes.body.data.description).toBe('Parity updated description');
    expect(browserRes.body.data.description).toBe('Parity updated description');
  });

  it('proves parity on 200 SUCCESS (PUT /api/v1/classes/:id/eligibility)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .put(`/api/v1/classes/${sampleClass.id}/eligibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ planIds: [plan.id] });
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(mobileRes.body.data.planIds).toEqual([plan.id]);
  });

  it('proves parity on 200 SUCCESS (POST /api/v1/classes/:id/deactivate)', async () => {
    const classToDeactivate = await createTestClass(PREFIX, {
      name: `${PREFIX}ToDeactivate`,
      active: true,
      visibility: 'PUBLIC',
    });

    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .post(`/api/v1/classes/${classToDeactivate.id}/deactivate`)
        .set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(mobileRes.body.data).toEqual({
      id: classToDeactivate.id,
      status: 'deactivated',
      active: false,
    });
  });

  it('proves parity on 200 SUCCESS (POST /api/v1/classes/:id/activate)', async () => {
    const classToActivate = await createTestClass(PREFIX, {
      name: `${PREFIX}ToActivate`,
      status: 'DEACTIVATED',
      visibility: 'PUBLIC',
    });

    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .post(`/api/v1/classes/${classToActivate.id}/activate`)
        .set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(mobileRes.body.data).toEqual({
      id: classToActivate.id,
      status: 'active',
      active: true,
    });
  });

  it('proves parity on 200 SUCCESS (POST /api/v1/classes/:id/archive)', async () => {
    const classToArchive = await createTestClass(PREFIX, {
      name: `${PREFIX}ToArchive`,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
    });

    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .post(`/api/v1/classes/${classToArchive.id}/archive`)
        .set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(200);
    expect(mobileRes.body.success).toBe(true);
    expect(mobileRes.body.data).toEqual({
      id: classToArchive.id,
      status: 'archived',
      active: false,
    });
  });

  it('proves parity on 401 UNAUTHORIZED (POST /api/v1/classes without token)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req.post('/api/v1/classes').send({});
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(401);
    expect(mobileRes.body.code).toBe('UNAUTHORIZED');
  });

  it('proves parity on 403 FORBIDDEN (POST /api/v1/classes by Member)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req.post('/api/v1/classes').set('Authorization', bearerFor(memberUser)).send({});
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(403);
    expect(mobileRes.body.code).toBe('FORBIDDEN');
  });

  it('proves parity on 404 NOT_FOUND (GET /api/v1/classes/:id with non-existent id)', async () => {
    const unknownId = 'f0000000-0000-4000-8000-000000000099';
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req.get(`/api/v1/classes/${unknownId}`).set('Authorization', bearerFor(adminUser));
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(404);
    expect(mobileRes.body.code).toBe('CLASS_NOT_FOUND');
  });

  it('proves parity on 409 CONFLICT (POST duplicate name)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send({
          name: sampleClass.name,
          durationMin: 60,
          baseCapacity: 10,
          classType: 'onsite',
          intensity: 3,
          visibility: 'public',
          classPassEnabled: false,
          classpassSpots: 0,
          eligiblePlanIds: [plan.id],
        });
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(409);
    expect(mobileRes.body.code).toBe('CLASS_DUPLICATE_NAME');
  });

  it('proves parity on 422 VALIDATION_ERROR (POST invalid intensity)', async () => {
    const { mobileRes } = await sendWithClientTypes((req, headers) => {
      let r = req
        .post('/api/v1/classes')
        .set('Authorization', bearerFor(adminUser))
        .send({
          name: `${PREFIX}BadIntensity`,
          durationMin: 60,
          baseCapacity: 10,
          intensity: 99,
          visibility: 'public',
          eligiblePlanIds: [plan.id],
        });
      Object.entries(headers).forEach(([k, v]) => {
        r = r.set(k, v);
      });
      return r;
    });
    expect(mobileRes.status).toBe(422);
    expect(mobileRes.body.code).toBe('VALIDATION_ERROR');
  });

  it('proves parity on 429 TOO_MANY_REQUESTS', async () => {
    const express = require('express');
    const { createPlanLimiter } = require('../../src/middlewares/rateLimiter.middleware');
    const errorHandler = require('../../src/middlewares/errorHandler.middleware');

    const rateLimitApp = express();
    rateLimitApp.use(express.json());
    const strictLimiter = createPlanLimiter({ max: 1, windowMs: 60000 });
    rateLimitApp.get('/test-rate-limit-parity', strictLimiter, (_req, res) =>
      res.json({ success: true }),
    );
    rateLimitApp.use(errorHandler);

    // Consume the 1 allowed request
    await request(rateLimitApp).get('/test-rate-limit-parity');

    // Both subsequent requests from mobile and web are rate-limited
    const mobileRes = await request(rateLimitApp)
      .get('/test-rate-limit-parity')
      .set('User-Agent', 'okhttp/4.12.0');

    const browserRes = await request(rateLimitApp)
      .get('/test-rate-limit-parity')
      .set('Origin', 'http://localhost:3000')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
      .set('Cookie', 'session=junk_session_cookie; theme=dark');

    expect(mobileRes.status).toBe(429);
    expect(browserRes.status).toBe(429);
    expect(mobileRes.headers['content-type']).toMatch(/application\/json/);
    expect(browserRes.headers['content-type']).toMatch(/application\/json/);
    expect(mobileRes.body).toEqual(browserRes.body);
    expect(mobileRes.body.code).toBe('TOO_MANY_REQUESTS');
  });
});
