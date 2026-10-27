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
  createTestMembership,
  deleteTestMemberships,
} = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('PATCH /api/v1/plans/:id', () => {
  const PREFIX = 'test_slmp04_upd_';
  const testData = createTestData('slmp04_upd');
  let app;
  let users;

  const cleanup = async () => {
    await deleteTestPlanAudits(PREFIX);
    await deleteTestPlans(PREFIX);
    await deleteTestMemberships(PREFIX);
  };

  const patchAs = (user, id, body) =>
    request(app).patch(`/api/v1/plans/${id}`).set('Authorization', bearerFor(user)).send(body);

  const reload = (id) => prisma.membershipPlan.findUnique({ where: { id } });

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
      const res = await request(app).patch(`/api/v1/plans/${plan.id}`).send({ price: 1 });
      expect(res.status).toBe(401);
    });

    it.each(['coach', 'member'])('returns 403 for a %s and changes nothing', async (role) => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users[role], plan.id, { price: 999 });

      expect(res.status).toBe(403);
      expect((await reload(plan.id)).price.toNumber()).toBe(100);
    });

    it.each(['owner', 'admin'])('returns 200 for %s', async (role) => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users[role], plan.id, { description: 'by ' + role });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Membership plan updated successfully',
      });
    });
  });

  describe('Partial update', () => {
    it('changes only the sent fields and returns the full record', async () => {
      const plan = await createTestPlan(PREFIX, { description: 'keep me' });

      const res = await patchAs(users.admin, plan.id, { price: 125.5 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: plan.id,
        name: plan.name,
        price: 125.5,
        description: 'keep me',
        creditsIncluded: 10,
        status: 'active',
        section: 'class_membership',
        activeClientCount: 0,
      });
      const row = await reload(plan.id);
      expect(row).toMatchObject({ name: plan.name, description: 'keep me', creditsIncluded: 10 });
      expect(row.updatedAt.getTime()).toBeGreaterThan(plan.updatedAt.getTime());
    });

    it('trims the name and accepts values in any letter case', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, {
        name: `  ${PREFIX}Trimmed  `,
        visibility: 'HIDDEN',
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: `${PREFIX}Trimmed`, visibility: 'hidden' });
    });

    it('lets an inactive plan be edited', async () => {
      const plan = await createTestPlan(PREFIX, { status: 'INACTIVE' });
      const res = await patchAs(users.owner, plan.id, { description: 'edited while inactive' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('inactive');
    });

    it('clears the description with null', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.owner, plan.id, { description: null });
      expect(res.body.data.description).toBeNull();
    });

    it('switches a plan with no clients between credits and time (needs the time rules)', async () => {
      const plan = await createTestPlan(PREFIX);

      const toTime = await patchAs(users.admin, plan.id, {
        creditType: 'time',
        creditsIncluded: 0,
        creditRefill: null,
      });
      expect(toTime.status).toBe(200);
      expect(toTime.body.data).toMatchObject({
        creditType: 'time',
        section: 'online_coaching',
        creditSummary: 'Time-based access',
        version: 2,
      });

      const back = await patchAs(users.admin, plan.id, {
        creditType: 'class',
        creditsIncluded: 8,
      });
      expect(back.status).toBe(200);
      expect(back.body.data).toMatchObject({ section: 'class_membership', version: 3 });
    });
  });

  describe('Not found and archived', () => {
    it('returns 404 PLAN_NOT_FOUND for an unknown or malformed id', async () => {
      const unknown = await patchAs(users.admin, crypto.randomUUID(), { price: 1 });
      const malformed = await patchAs(users.admin, 'not-a-uuid', { price: 1 });

      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('PLAN_NOT_FOUND');
      expect(malformed.status).toBe(404);
    });

    it('returns 409 plan_archived for an archived plan and changes nothing', async () => {
      const plan = await createTestPlan(PREFIX, { status: 'ARCHIVED' });

      const res = await patchAs(users.admin, plan.id, { price: 999 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: 'plan_archived' });
      expect((await reload(plan.id)).price.toNumber()).toBe(100);
    });
  });

  describe('Fields that cannot be edited (422)', () => {
    it.each([
      ['id', crypto.randomUUID()],
      ['section', 'online_coaching'],
      ['version', 9],
      ['externalRef', 'GLOFOX-1'],
      ['createdAt', '2020-01-01T00:00:00.000Z'],
      ['updatedAt', '2020-01-01T00:00:00.000Z'],
      ['joiningFee', 50],
    ])('rejects %s', async (field, value) => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { description: 'x', [field]: value });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toEqual([{ field, message: 'This field cannot be edited' }]);
      expect((await reload(plan.id)).description).toBe('original description');
    });

    it('rejects status and points to the status endpoint', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { status: 'archived' });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('status');
      expect(res.body.errors[0].message).toContain('PATCH /api/v1/plans/:id/status');
      expect((await reload(plan.id)).status).toBe('ACTIVE');
    });

    it('rejects unknown fields and an empty body', async () => {
      const plan = await createTestPlan(PREFIX);
      const unknown = await patchAs(users.admin, plan.id, { colour: 'red' });
      const empty = await patchAs(users.admin, plan.id, {});

      expect(unknown.status).toBe(422);
      expect(empty.status).toBe(422);
    });

    it('rejects membership object in body with 422', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { membership: { name: 'New Membership' } });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].field).toBe('membership');
    });
  });

  describe('Membership assignment via PATCH', () => {
    it('reassigns a standalone plan to an existing membership and returns nested membership', async () => {
      const membership = await createTestMembership(PREFIX, { name: `${PREFIX}Gold Tier` });
      const plan = await createTestPlan(PREFIX, { description: 'standalone before' });

      const res = await patchAs(users.admin, plan.id, { membershipId: membership.id });

      expect(res.status).toBe(200);
      expect(res.body.data.membershipId).toBe(membership.id);
      expect(res.body.data.membership).toMatchObject({
        id: membership.id,
        name: membership.name,
      });

      const row = await reload(plan.id);
      expect(row.membershipId).toBe(membership.id);
    });

    it('reassigns a membership plan to standalone with null', async () => {
      const membership = await createTestMembership(PREFIX, { name: `${PREFIX}Silver Tier` });
      const plan = await createTestPlan(PREFIX, { membershipId: membership.id });

      const res = await patchAs(users.admin, plan.id, { membershipId: null });

      expect(res.status).toBe(200);
      expect(res.body.data.membershipId).toBeNull();
      expect(res.body.data.membership).toBeNull();

      const row = await reload(plan.id);
      expect(row.membershipId).toBeNull();
    });

    it('reassigns a plan from one membership to another', async () => {
      const mem1 = await createTestMembership(PREFIX, { name: `${PREFIX}Mem One` });
      const mem2 = await createTestMembership(PREFIX, { name: `${PREFIX}Mem Two` });
      const plan = await createTestPlan(PREFIX, { membershipId: mem1.id });

      const res = await patchAs(users.admin, plan.id, { membershipId: mem2.id });

      expect(res.status).toBe(200);
      expect(res.body.data.membershipId).toBe(mem2.id);
      expect(res.body.data.membership.name).toBe(mem2.name);
    });

    it('rejects a non-existent membershipId with 422', async () => {
      const plan = await createTestPlan(PREFIX);
      const fakeId = crypto.randomUUID();

      const res = await patchAs(users.admin, plan.id, { membershipId: fakeId });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].field).toBe('membershipId');
    });

    it('rejects an invalid non-UUID membershipId string with 422', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { membershipId: 'not-a-valid-uuid' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].field).toBe('membershipId');
    });

    it('records membershipId in the audit log', async () => {
      const mem = await createTestMembership(PREFIX, { name: `${PREFIX}Audit Tier` });
      const plan = await createTestPlan(PREFIX);

      await patchAs(users.admin, plan.id, { membershipId: mem.id });

      const audits = await findPlanAudits(plan.id, AuditAction.PLAN_UPDATED);
      expect(audits).toHaveLength(1);
      const changes = audits[0].details.changes;
      expect(changes.membershipId).toEqual({ from: null, to: mem.id });
    });
  });

  describe('Validation of the merged result (422)', () => {
    it('applies the create rules to the merged plan', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { price: -5, kind: 'trial' });

      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field).sort()).toEqual(['billingCycle', 'price']);
      expect(res.body.errors.find((e) => e.field === 'billingCycle').message).toBe(
        'Only a membership renews monthly.',
      );
    });

    it('rejects a lone switch to time, because the merged plan breaks the time rules', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { creditType: 'time' });

      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field).sort()).toEqual([
        'creditRefill',
        'creditsIncluded',
      ]);
      expect((await reload(plan.id)).creditType).toBe('CLASS');
    });

    it('rejects a lone field that breaks a rule against the stored values', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { billingCycle: 'year' });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toEqual(['creditRefill']);
    });
  });

  describe('Check order', () => {
    it('404 comes before body validation', async () => {
      const res = await patchAs(users.admin, crypto.randomUUID(), { id: 'x' });
      expect(res.status).toBe(404);
    });

    it('plan_archived comes before body validation', async () => {
      const plan = await createTestPlan(PREFIX, { status: 'ARCHIVED' });
      const res = await patchAs(users.admin, plan.id, { id: 'x', price: -1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('plan_archived');
    });

    it('non-editable fields come before the merged validation', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { version: 3, price: -1 });
      expect(res.body.errors.map((e) => e.field)).toEqual(['version']);
    });

    it('validation comes before duplicate_name', async () => {
      const taken = await createTestPlan(PREFIX);
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { name: taken.name, price: -1 });
      expect(res.status).toBe(422);
    });
  });

  describe('duplicate_name', () => {
    it('returns 409 when another plan has the name (case-insensitive)', async () => {
      const taken = await createTestPlan(PREFIX, { name: `${PREFIX}Taken Name` });
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, { name: taken.name.toUpperCase() });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: 'duplicate_name' });
      expect((await reload(plan.id)).name).toBe(plan.name);
    });

    it('allows a plan to change the letter case of its own name', async () => {
      const plan = await createTestPlan(PREFIX, { name: `${PREFIX}Own Name` });
      const res = await patchAs(users.admin, plan.id, { name: `${PREFIX}OWN NAME` });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe(`${PREFIX}OWN NAME`);
    });

    it('ignores the name of an archived plan', async () => {
      const archived = await createTestPlan(PREFIX, {
        name: `${PREFIX}Archived Name`,
        status: 'ARCHIVED',
      });
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { name: archived.name });
      expect(res.status).toBe(200);
    });
  });

  describe('Versioning', () => {
    it('bumps the version by 1 when a commercial field changes', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, { price: 200 });
      expect(res.body.data.version).toBe(2);
      expect((await reload(plan.id)).version).toBe(2);
    });

    it('bumps by 1, not more, when several commercial fields change together', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, {
        price: 300,
        creditsIncluded: 20,
        validityValue: 2,
      });
      expect(res.body.data.version).toBe(2);
    });

    it('keeps the version when only non-commercial fields change', async () => {
      const plan = await createTestPlan(PREFIX);
      const res = await patchAs(users.admin, plan.id, {
        description: 'new text',
        name: `${PREFIX}Renamed`,
        visibility: 'hidden',
        startsOn: 'first_booking',
        oneTimePurchasePerClient: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(1);
    });

    it('keeps the version, and writes nothing, when a field is sent with its current value', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await patchAs(users.admin, plan.id, {
        price: 100,
        description: 'original description',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(1);
      const row = await reload(plan.id);
      expect(row.updatedAt).toEqual(plan.updatedAt);
      expect(await findPlanAudits(plan.id, AuditAction.PLAN_UPDATED)).toHaveLength(0);
    });
  });

  describe('Audit log', () => {
    it('records the changed fields with old and new values, the version and the actor', async () => {
      const plan = await createTestPlan(PREFIX);

      await patchAs(users.owner, plan.id, { price: 250, description: 'after' });

      const audits = await findPlanAudits(plan.id, AuditAction.PLAN_UPDATED);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorId: users.owner.id,
        actorRole: Role.OWNER,
        reason: `${plan.name} (${plan.id})`,
        details: {
          changes: {
            price: { from: 100, to: 250 },
            description: { from: 'original description', to: 'after' },
          },
          version: { from: 1, to: 2 },
        },
      });
      expect(Object.keys(audits[0].details.changes).sort()).toEqual(['description', 'price']);
      expect(audits[0].ipAddress).toBeTruthy();
    });

    it('records enum values in the API format and a version that did not move', async () => {
      const plan = await createTestPlan(PREFIX);

      await patchAs(users.admin, plan.id, { visibility: 'hidden' });

      const [audit] = await findPlanAudits(plan.id, AuditAction.PLAN_UPDATED);
      expect(audit.details).toEqual({
        changes: { visibility: { from: 'public', to: 'hidden' } },
        version: { from: 1, to: 1 },
      });
    });

    it('writes no audit row when the request is rejected', async () => {
      const plan = await createTestPlan(PREFIX);
      await patchAs(users.admin, plan.id, { price: -1 });
      await patchAs(users.coach, plan.id, { price: 5 });
      expect(await findPlanAudits(plan.id, AuditAction.PLAN_UPDATED)).toHaveLength(0);
    });
  });

  describe('Method not allowed', () => {
    it('answers 405 with Allow for DELETE, also without a token', async () => {
      const plan = await createTestPlan(PREFIX);

      const res = await request(app).delete(`/api/v1/plans/${plan.id}`);
      const asAdmin = await request(app)
        .delete(`/api/v1/plans/${plan.id}`)
        .set('Authorization', bearerFor(users.admin));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, PATCH');
      expect(res.body).toMatchObject({ success: false, code: 'METHOD_NOT_ALLOWED' });
      expect(asAdmin.status).toBe(405);
      expect(await reload(plan.id)).not.toBeNull();
    });

    it('answers 405 for PUT and POST on a plan', async () => {
      const plan = await createTestPlan(PREFIX);
      expect((await request(app).put(`/api/v1/plans/${plan.id}`)).status).toBe(405);
      expect((await request(app).post(`/api/v1/plans/${plan.id}`)).status).toBe(405);
    });
  });

  describe('Web and mobile clients', () => {
    it('returns the same status and data with a browser Origin and without one', async () => {
      const plan = await createTestPlan(PREFIX);
      const other = await createTestPlan(PREFIX);

      const web = await request(app)
        .patch(`/api/v1/plans/${plan.id}`)
        .set('Authorization', bearerFor(users.admin))
        .set('Origin', 'http://localhost:3000')
        .send({ description: 'same' });
      const mobile = await request(app)
        .patch(`/api/v1/plans/${other.id}`)
        .set('Authorization', bearerFor(users.admin))
        .set('User-Agent', 'okhttp/4.12.0')
        .send({ description: 'same' });

      expect(web.status).toBe(200);
      expect(mobile.status).toBe(200);
      const withoutIdentity = (body) => {
        const data = { ...body.data };
        ['id', 'name', 'createdAt', 'updatedAt'].forEach((key) => delete data[key]);
        return data;
      };
      expect(withoutIdentity(mobile.body)).toEqual(withoutIdentity(web.body));
    });
  });

  describe('Rate limiter', () => {
    it('is on the PATCH route', () => {
      const layer = planRoutes.stack.find(
        (item) => item.route?.path === '/:id' && item.route.methods.patch,
      );
      expect(layer.route.stack.map((item) => item.handle)).toContain(planLimiter);
    });

    it('answers 429 TOO_MANY_REQUESTS with the standard envelope when exceeded', async () => {
      const testApp = express();
      testApp.patch('/plans/:id', createPlanLimiter({ max: 1, windowMs: 60000 }), (_req, res) =>
        res.status(200).json({ success: true }),
      );
      testApp.use(require('../../src/middlewares/errorHandler.middleware'));

      expect((await request(testApp).patch('/plans/x')).status).toBe(200);
      const limited = await request(testApp).patch('/plans/x');
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
