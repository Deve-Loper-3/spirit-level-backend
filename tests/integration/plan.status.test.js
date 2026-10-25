const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const planRoutes = require('../../src/routes/plan.routes');
const { createPlanLimiter, planLimiter } = require('../../src/middlewares/rateLimiter.middleware');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestPlans,
  deleteTestPlanAudits,
  createTestPlan,
  findPlanAudits,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('PATCH /api/v1/plans/:id/status', () => {
  const PREFIX = 'test_slmp05_';
  const testData = createTestData('slmp05_status');
  let app;
  let users;

  const cleanup = async () => {
    await deleteTestPlanAudits(PREFIX);
    await deleteTestPlans(PREFIX);
  };

  const setStatusAs = (user, id, body) =>
    request(app)
      .patch(`/api/v1/plans/${id}/status`)
      .set('Authorization', bearerFor(user))
      .send(body);

  const reload = (id) => prisma.membershipPlan.findUnique({ where: { id } });
  const audits = (id) => findPlanAudits(id, AuditAction.PLAN_STATUS_CHANGED);

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    users = {
      owner: await testData.createUser({ role: Role.OWNER }),
      admin: await testData.createUser({ role: Role.ADMIN }),
      coach: await testData.createUser({ role: Role.COACH }),
      member: await testData.createUser({ role: Role.MEMBER }),
    };
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('Authorization', () => {
    it('returns 401 without a token', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await request(app)
        .patch(`/api/v1/plans/${plan.id}/status`)
        .send({ status: 'inactive' });
      expect(res.status).toBe(401);
    });

    it.each(['coach', 'member'])('returns 403 for a %s and changes nothing', async (role) => {
      const plan = await createTestPlan(PREFIX);

      const res = await setStatusAs(users[role], plan.id, { status: 'archived' });

      expect(res.status).toBe(403);
      expect((await reload(plan.id)).status).toBe('ACTIVE');
      expect(await audits(plan.id)).toHaveLength(0);
    });

    it.each(['owner', 'admin'])('returns 200 for %s', async (role) => {
      const plan = await createTestPlan(PREFIX);
      const res = await setStatusAs(users[role], plan.id, { status: 'inactive' });
      expect(res.status).toBe(200);
    });
  });

  describe('Not found', () => {
    it('returns 404 for an unknown or malformed id', async () => {
      const unknown = await setStatusAs(users.admin, crypto.randomUUID(), { status: 'inactive' });
      const malformed = await setStatusAs(users.admin, 'not-a-uuid', { status: 'inactive' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('PLAN_NOT_FOUND');
      expect(malformed.status).toBe(404);
    });

    it('404 comes before body validation', async () => {
      const res = await setStatusAs(users.admin, crypto.randomUUID(), { status: 'nonsense' });
      expect(res.status).toBe(404);
    });
  });

  describe('Body validation (422)', () => {
    it.each([
      ['no status', {}, ['status']],
      ['an unknown status', { status: 'deleted' }, ['status']],
      ['a status that is not text', { status: 5 }, ['status']],
      ['a reason over 200 characters', { status: 'inactive', reason: 'a'.repeat(201) }, ['reason']],
      ['another field', { status: 'inactive', price: 1 }, ['']],
    ])('rejects %s', async (_label, body, fields) => {
      const plan = await createTestPlan(PREFIX);

      const res = await setStatusAs(users.admin, plan.id, body);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e) => e.field)).toEqual(fields);
      expect((await reload(plan.id)).status).toBe('ACTIVE');
    });

    it('accepts a reason of exactly 200 characters and any letter case', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await setStatusAs(users.admin, plan.id, {
        status: 'INACTIVE',
        reason: 'a'.repeat(200),
      });
      expect(res.status).toBe(200);
    });

    it('validates the body before the same-status shortcut', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await setStatusAs(users.admin, plan.id, {
        status: 'active',
        reason: 'a'.repeat(201),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('Allowed transitions', () => {
    it.each([
      ['ACTIVE', 'inactive'],
      ['ACTIVE', 'archived'],
      ['INACTIVE', 'active'],
      ['INACTIVE', 'archived'],
      ['ARCHIVED', 'inactive'],
    ])('%s -> %s returns 200 with { id, status, updatedAt }', async (from, to) => {
      const plan = await createTestPlan(PREFIX, { status: from });

      const res = await setStatusAs(users.admin, plan.id, { status: to });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: plan.id,
        status: to,
        updatedAt: expect.any(String),
      });
      expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(plan.updatedAt.getTime());
      expect((await reload(plan.id)).status).toBe(to.toUpperCase());
    });
  });

  describe('Invalid transitions (409 invalid_transition)', () => {
    it.each([['ARCHIVED', 'active']])(
      '%s -> %s is rejected and changes nothing',
      async (from, to) => {
        const plan = await createTestPlan(PREFIX, { status: from });

        const res = await setStatusAs(users.admin, plan.id, { status: to });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, code: 'invalid_transition' });
        expect((await reload(plan.id)).status).toBe(from);
        expect(await audits(plan.id)).toHaveLength(0);
      },
    );
  });

  describe('Same status again', () => {
    it.each(['ACTIVE', 'INACTIVE', 'ARCHIVED'])(
      '%s -> same returns 200 with no change and no audit entry',
      async (status) => {
        const plan = await createTestPlan(PREFIX, { status });

        const res = await setStatusAs(users.admin, plan.id, {
          status: status.toLowerCase(),
          reason: 'again',
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          id: plan.id,
          status: status.toLowerCase(),
          updatedAt: plan.updatedAt.toISOString(),
        });
        expect((await reload(plan.id)).updatedAt).toEqual(plan.updatedAt);
        expect(await audits(plan.id)).toHaveLength(0);
      },
    );
  });

  describe('Audit log', () => {
    it('records from, to and the reason with the actor', async () => {
      const plan = await createTestPlan(PREFIX);

      await setStatusAs(users.owner, plan.id, { status: 'archived', reason: '  Season over  ' });

      const [audit] = await audits(plan.id);
      expect(audit).toMatchObject({
        action: AuditAction.PLAN_STATUS_CHANGED,
        actorId: users.owner.id,
        actorRole: Role.OWNER,
        reason: `${plan.name} (${plan.id})`,
        details: { from: 'active', to: 'archived', reason: 'Season over' },
      });
      expect(audit.ipAddress).toBeTruthy();
    });

    it('records a missing reason as null and one entry per real change', async () => {
      const plan = await createTestPlan(PREFIX);

      await setStatusAs(users.admin, plan.id, { status: 'inactive' });
      await setStatusAs(users.admin, plan.id, { status: 'inactive' });
      await setStatusAs(users.admin, plan.id, { status: 'active', reason: 'back' });

      const entries = await audits(plan.id);
      expect(entries.map((entry) => entry.details)).toEqual([
        { from: 'active', to: 'inactive', reason: null },
        { from: 'inactive', to: 'active', reason: 'back' },
      ]);
    });
  });

  describe('Effects on the plan', () => {
    it('does not change the version or any other field', async () => {
      const plan = await createTestPlan(PREFIX, { price: 321 });

      await setStatusAs(users.admin, plan.id, { status: 'inactive' });
      await setStatusAs(users.admin, plan.id, { status: 'archived' });
      await setStatusAs(users.admin, plan.id, { status: 'inactive' });

      const row = await reload(plan.id);
      const withoutStatusFields = (value) => {
        const copy = { ...value };
        delete copy.status;
        delete copy.updatedAt;
        return copy;
      };
      expect(row.version).toBe(1);
      expect(withoutStatusFields(row)).toEqual(withoutStatusFields(plan));
    });

    it('keeps a plan readable, and out of the default list, once archived', async () => {
      const plan = await createTestPlan(PREFIX, { name: `${PREFIX}Archive Me` });
      await setStatusAs(users.admin, plan.id, { status: 'archived' });

      const detail = await request(app)
        .get(`/api/v1/plans/${plan.id}`)
        .set('Authorization', bearerFor(users.coach));
      const list = await request(app)
        .get('/api/v1/plans')
        .set('Authorization', bearerFor(users.coach))
        .query({ q: 'Archive Me', pageSize: 100 });

      expect(detail.body.data.status).toBe('archived');
      expect(list.body.data).toEqual([]);
    });
  });

  describe('Restoring an archived plan', () => {
    it('returns 409 duplicate_name when another plan took the name, and changes nothing', async () => {
      const archived = await createTestPlan(PREFIX, {
        name: `${PREFIX}Reused Name`,
        status: 'ARCHIVED',
      });
      await createTestPlan(PREFIX, { name: `${PREFIX}REUSED NAME`, status: 'ACTIVE' });

      const res = await setStatusAs(users.admin, archived.id, { status: 'inactive' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: 'duplicate_name' });
      expect((await reload(archived.id)).status).toBe('ARCHIVED');
      expect(await audits(archived.id)).toHaveLength(0);
    });

    it('restores when the name is free again', async () => {
      const archived = await createTestPlan(PREFIX, {
        name: `${PREFIX}Free Name`,
        status: 'ARCHIVED',
      });
      const res = await setStatusAs(users.admin, archived.id, { status: 'inactive' });
      expect(res.status).toBe(200);
    });

    it('the transition check comes before the duplicate-name check', async () => {
      const archived = await createTestPlan(PREFIX, {
        name: `${PREFIX}Order Name`,
        status: 'ARCHIVED',
      });
      await createTestPlan(PREFIX, { name: `${PREFIX}Order Name 2` });
      await createTestPlan(PREFIX, { name: `${PREFIX}ORDER NAME` });

      const res = await setStatusAs(users.admin, archived.id, { status: 'active' });

      expect(res.body.code).toBe('invalid_transition');
    });
  });

  describe('No DELETE', () => {
    it('answers 405 with Allow: PATCH for DELETE and other methods on the status route', async () => {
      const plan = await createTestPlan(PREFIX);

      const del = await request(app)
        .delete(`/api/v1/plans/${plan.id}/status`)
        .set('Authorization', bearerFor(users.owner));
      const get = await request(app)
        .get(`/api/v1/plans/${plan.id}/status`)
        .set('Authorization', bearerFor(users.owner));

      expect(del.status).toBe(405);
      expect(del.headers.allow).toBe('PATCH');
      expect(get.status).toBe(405);
      expect((await reload(plan.id)).status).toBe('ACTIVE');
    });
  });

  describe('Web and mobile clients', () => {
    it('returns the same status and body shape with a browser Origin and without one', async () => {
      const a = await createTestPlan(PREFIX);
      const b = await createTestPlan(PREFIX);

      const web = await request(app)
        .patch(`/api/v1/plans/${a.id}/status`)
        .set('Authorization', bearerFor(users.admin))
        .set('Origin', 'http://localhost:3000')
        .send({ status: 'inactive' });
      const mobile = await request(app)
        .patch(`/api/v1/plans/${b.id}/status`)
        .set('Authorization', bearerFor(users.admin))
        .set('User-Agent', 'okhttp/4.12.0')
        .send({ status: 'inactive' });

      expect(web.status).toBe(200);
      expect(mobile.status).toBe(200);
      expect(Object.keys(mobile.body.data)).toEqual(Object.keys(web.body.data));
      expect(mobile.body.message).toBe(web.body.message);
    });
  });

  describe('Rate limiter', () => {
    it('is on the status route', () => {
      const layer = planRoutes.stack.find(
        (item) => item.route?.path === '/:id/status' && item.route.methods.patch,
      );
      expect(layer.route.stack.map((item) => item.handle)).toContain(planLimiter);
    });

    it('answers 429 TOO_MANY_REQUESTS with the standard envelope when exceeded', async () => {
      const testApp = express();
      testApp.patch(
        '/plans/:id/status',
        createPlanLimiter({ max: 1, windowMs: 60000 }),
        (_req, res) => res.status(200).json({ success: true }),
      );
      testApp.use(require('../../src/middlewares/errorHandler.middleware'));

      expect((await request(testApp).patch('/plans/x/status')).status).toBe(200);
      const limited = await request(testApp).patch('/plans/x/status');
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
