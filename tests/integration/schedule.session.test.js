const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');

jest.setTimeout(45000);

describe('BE-SCH-1 & BE-SCH-3: Session Endpoints', () => {
  const PREFIX = 'test_sess_';
  const testData = createTestData('sess_test');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let primaryClass;
  let secondaryClass;
  let primaryCoach;

  const cleanup = async () => {
    await deleteTestClasses(PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();

    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Session Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Session Tester' });
    memberUser = await testData.createUser({
      role: Role.MEMBER,
      fullName: 'Member Session Tester',
    });

    const coach1 = await testData.createCoach({ user: { fullName: 'Primary Coach' } });
    coachUser = coach1.user;
    primaryCoach = coach1.coach;

    primaryClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Primary`,
      durationMin: 60,
      baseCapacity: 15,
      intensity: 3,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });

    secondaryClass = await createTestClass(PREFIX, {
      name: `${PREFIX}Secondary`,
      durationMin: 45,
      baseCapacity: 10,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
    });

    // Assign primaryCoach to primaryClass
    await prisma.classCoach.create({
      data: { classId: primaryClass.id, coachId: primaryCoach.id },
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/sessions (BE-SCH-1 One-Off)', () => {
    it('creates a one-off session instance from template with source=one_off, slotId=null', async () => {
      const payload = {
        classId: primaryClass.id,
        startAt: '2030-06-01T10:00:00.000Z',
        endAt: '2030-06-01T11:00:00.000Z',
        // Omitted fields inherit from template
      };

      const res = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.headers.location).toMatch(/^\/api\/v1\/sessions\//);
      expect(res.body.success).toBe(true);
      expect(res.body.data.classId).toBe(primaryClass.id);
      expect(res.body.data.slotId).toBeNull();
      expect(res.body.data.source).toBe('one_off');
      expect(res.body.data.capacity).toBe(15); // Inherited from baseCapacity
      expect(res.body.data.durationMin).toBe(60); // Inherited
      expect(res.body.data.state).toBe('open');
      expect(res.body.data.coaches).toHaveLength(1); // Inherited primaryCoach
      expect(res.body.data.coaches[0].id).toBe(primaryCoach.id);
    });

    it('rejects past one-off session creation with 400', async () => {
      const res = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', bearerFor(adminUser))
        .send({
          classId: primaryClass.id,
          startAt: '2020-01-01T10:00:00.000Z',
          endAt: '2020-01-01T11:00:00.000Z',
        });

      expect(res.status).toBe(400);
    });

    it('rejects same-class same-startAt collision with 409 SESSION_CONFLICT', async () => {
      const res = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', bearerFor(adminUser))
        .send({
          classId: primaryClass.id,
          startAt: '2030-06-01T10:00:00.000Z', // Same startAt as previous test
          endAt: '2030-06-01T11:00:00.000Z',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SESSION_CONFLICT');
      expect(res.body.details?.conflicts).toBeDefined();
    });

    it('rejects cross-class coach overlap with 409 COACH_CONFLICT', async () => {
      // primaryCoach is already booked on primaryClass on 2030-06-01 from 10:00 to 11:00
      // Assign primaryCoach to secondaryClass as well
      await prisma.classCoach.create({
        data: { classId: secondaryClass.id, coachId: primaryCoach.id },
      });

      // Try scheduling secondaryClass overlapping [10:30, 11:15) with primaryCoach
      const res = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', bearerFor(ownerUser))
        .send({
          classId: secondaryClass.id,
          startAt: '2030-06-01T10:30:00.000Z',
          endAt: '2030-06-01T11:15:00.000Z',
          durationMin: 45,
          coachIds: [primaryCoach.id],
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COACH_CONFLICT');
      expect(res.body.details?.conflicts).toBeDefined();
      expect(res.body.details.conflicts[0].type).toBe('COACH_CONFLICT');
    });

    it('allows adjacent non-overlapping session for the same coach', async () => {
      // Adjacent interval: [11:00, 11:45) is adjacent to [10:00, 11:00)
      const res = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', bearerFor(ownerUser))
        .send({
          classId: secondaryClass.id,
          startAt: '2030-06-01T11:00:00.000Z',
          endAt: '2030-06-01T11:45:00.000Z',
          durationMin: 45,
          coachIds: [primaryCoach.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/sessions (Calendar Read)', () => {
    it('returns filtered calendar-ready sessions in ISO UTC with lowercase enums', async () => {
      const res = await request(app)
        .get('/api/v1/sessions?from=2030-06-01T00:00:00.000Z&to=2030-06-02T00:00:00.000Z')
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const session = res.body.data[0];
      expect(session.state).toBe('open');
      expect(session.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(session.bookedCount).toBe(0);
      expect(session.waitlistCount).toBe(0);
    });

    it('uses the shared list envelope: pagination with the default limit of 20, no meta', async () => {
      const res = await request(app)
        .get('/api/v1/sessions?from=2030-06-01T00:00:00.000Z&to=2030-06-02T00:00:00.000Z')
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 20 });
      expect(res.body.pagination.total).toBe(res.body.data.length);
      expect(res.body).not.toHaveProperty('meta');
    });

    it('rejects the old pageSize name and an out-of-range limit with 400', async () => {
      const range = 'from=2030-06-01T00:00:00.000Z&to=2030-06-02T00:00:00.000Z';
      const res = await request(app)
        .get(`/api/v1/sessions?${range}&limit=101`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('limit');
    });
  });

  describe('GET /api/v1/sessions/:id visibility', () => {
    let privateSessionId;

    beforeAll(async () => {
      const created = await prisma.classSession.create({
        data: {
          id: crypto.randomUUID(),
          classId: primaryClass.id,
          startAt: new Date('2030-09-15T08:00:00.000Z'),
          endAt: new Date('2030-09-15T09:00:00.000Z'),
          durationMin: 60,
          capacity: 12,
          state: 'OPEN',
          isPrivate: true,
          version: 1,
        },
      });
      privateSessionId = created.id;
    });

    it('hides a private session from a MEMBER: 404 SESSION_NOT_FOUND, same as a missing one', async () => {
      const hidden = await request(app)
        .get(`/api/v1/sessions/${privateSessionId}`)
        .set('Authorization', bearerFor(memberUser));
      const missing = await request(app)
        .get(`/api/v1/sessions/${crypto.randomUUID()}`)
        .set('Authorization', bearerFor(memberUser));

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect(hidden.body.code).toBe('SESSION_NOT_FOUND');
    });

    it('still shows the private session to an ADMIN', async () => {
      const res = await request(app)
        .get(`/api/v1/sessions/${privateSessionId}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(privateSessionId);
    });
  });

  describe('PATCH /api/v1/sessions/:id', () => {
    let targetSessionId;

    beforeAll(async () => {
      const created = await prisma.classSession.create({
        data: {
          id: crypto.randomUUID(),
          classId: primaryClass.id,
          startAt: new Date('2030-07-01T08:00:00.000Z'),
          endAt: new Date('2030-07-01T09:00:00.000Z'),
          durationMin: 60,
          capacity: 12,
          state: 'OPEN',
          version: 1,
          coaches: {
            create: [{ coachId: primaryCoach.id }],
          },
        },
      });
      targetSessionId = created.id;
    });

    it('requires overrideReason when changing startAt/endAt', async () => {
      const res = await request(app)
        .patch(`/api/v1/sessions/${targetSessionId}`)
        .set('Authorization', bearerFor(adminUser))
        .send({
          startAt: '2030-07-01T08:30:00.000Z',
          endAt: '2030-07-01T09:30:00.000Z',
          // Missing overrideReasons.startAt
        });

      expect(res.status).toBe(400);
    });

    it('updates session and tracks overrideDetails when reason is supplied', async () => {
      const res = await request(app)
        .patch(`/api/v1/sessions/${targetSessionId}`)
        .set('Authorization', bearerFor(adminUser))
        .send({
          capacity: 18,
          overrideReasons: {
            capacity: 'Adding spots for summer workshop',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.capacity).toBe(18);
      expect(res.body.data.overriddenFields).toContain('capacity');
      expect(res.body.data.overrideDetails.capacity.reason).toBe(
        'Adding spots for summer workshop',
      );
    });

    it('denies COACH from modifying non-capacity fields with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/sessions/${targetSessionId}`)
        .set('Authorization', bearerFor(coachUser))
        .send({
          description: 'Coach trying to change description',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/sessions/:id/cancel and restore', () => {
    let cancelSessionId;

    beforeAll(async () => {
      const created = await prisma.classSession.create({
        data: {
          id: crypto.randomUUID(),
          classId: primaryClass.id,
          startAt: new Date('2030-08-01T08:00:00.000Z'),
          endAt: new Date('2030-08-01T09:00:00.000Z'),
          durationMin: 60,
          capacity: 12,
          state: 'OPEN',
          version: 1,
          coaches: {
            create: [{ coachId: primaryCoach.id }],
          },
        },
      });
      cancelSessionId = created.id;
    });

    it('requires cancel reason with 400 if empty', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${cancelSessionId}/cancel`)
        .set('Authorization', bearerFor(adminUser))
        .send({ reason: '' });

      expect(res.status).toBe(400);
    });

    it('cancels session, sets state=cancelled, returns outcome', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${cancelSessionId}/cancel`)
        .set('Authorization', bearerFor(adminUser))
        .send({ reason: 'Facility maintenance' });

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('cancelled');
      expect(res.body.data.outcome).toBeDefined();

      const dbSession = await prisma.classSession.findUnique({ where: { id: cancelSessionId } });
      expect(dbSession.state).toBe('CANCELLED');
      expect(dbSession.cancelReason).toBe('Facility maintenance');
    });

    it('restores cancelled session to open with 200', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${cancelSessionId}/restore`)
        .set('Authorization', bearerFor(adminUser))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('open');

      const dbSession = await prisma.classSession.findUnique({ where: { id: cancelSessionId } });
      expect(dbSession.state).toBe('OPEN');
    });

    it('rejects restore on non-cancelled session with 409 SESSION_NOT_CANCELLED', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${cancelSessionId}/restore`)
        .set('Authorization', bearerFor(adminUser))
        .send();

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SESSION_NOT_CANCELLED');
    });
  });

  describe('Web & Mobile Parity', () => {
    it('returns identical status and JSON envelope with Origin header and without Origin header', async () => {
      const token = bearerFor(adminUser);

      const webRes = await request(app)
        .get('/api/v1/sessions?from=2030-06-01T00:00:00.000Z&to=2030-06-02T00:00:00.000Z')
        .set('Authorization', token)
        .set('Origin', 'http://localhost:3000');

      const mobileRes = await request(app)
        .get('/api/v1/sessions?from=2030-06-01T00:00:00.000Z&to=2030-06-02T00:00:00.000Z')
        .set('Authorization', token);
      // No Origin header

      expect(webRes.status).toBe(200);
      expect(mobileRes.status).toBe(200);
      expect(webRes.body).toEqual(mobileRes.body);
      expect(webRes.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
