const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { seedBookingRules } = require('../../prisma/seeds/bookingRules.seed');
const {
  getRule,
  isFeatureEnabled,
  getLimitValue,
} = require('../../src/services/bookingRule.service');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  snapshotBookingRules,
  restoreBookingRules,
  findBookingRuleAudits,
  deleteBookingRuleAudits,
} = require('../helpers/bookingRule.helper');

jest.setTimeout(60000);

const BASE = '/api/v1/settings/booking-rules';

describe('Booking rules endpoints', () => {
  const testData = createTestData('booking_rules');
  let app;
  let snapshot;
  let owner;
  let admin;
  let coach;
  let member;

  const as = (user) => ({ Authorization: bearerFor(user) });
  const idOf = async (ruleKey) => (await prisma.bookingRule.findUnique({ where: { ruleKey } })).id;
  const rowOf = (ruleKey) => prisma.bookingRule.findUnique({ where: { ruleKey } });
  const auditRows = (action) => findBookingRuleAudits(action, owner.id);
  const allRules = (body) => body.data.categories.flatMap((c) => c.rules);

  beforeAll(async () => {
    app = createApp();
    snapshot = await snapshotBookingRules();
    owner = await testData.createUser({ role: Role.OWNER });
    admin = await testData.createUser({ role: Role.ADMIN });
    coach = await testData.createUser({ role: Role.COACH });
    member = await testData.createUser({ role: Role.MEMBER });
  });

  beforeEach(async () => {
    await prisma.bookingRule.deleteMany();
    await seedBookingRules();
    await deleteBookingRuleAudits([owner.id]);
  });

  afterAll(async () => {
    await restoreBookingRules(snapshot);
    await deleteBookingRuleAudits([owner.id, admin.id, coach.id, member.id]);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('GET /settings/booking-rules', () => {
    it('returns the rules grouped by category for the Owner', async () => {
      const res = await request(app).get(BASE).set(as(owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.categories.map((c) => c.category)).toEqual([
        'booking_window',
        'cancellations',
        'waitlist_guests_capacity',
        'booking_limit',
        'appointments',
        'facilities',
        'memberships_accounts',
        'classpass',
      ]);
      expect(allRules(res.body)).toHaveLength(21);
      expect(res.body.data.categories[0]).toMatchObject({ label: 'Booking Window' });
    });

    it('returns id, ruleKey, category, name, value, unit, enabled and an ISO updatedAt', async () => {
      const res = await request(app).get(BASE).set(as(owner));
      const opens = allRules(res.body).find((r) => r.ruleKey === 'BOOKING_WINDOW_OPENS');

      expect(Object.keys(opens).sort()).toEqual(
        ['category', 'enabled', 'id', 'name', 'ruleKey', 'unit', 'updatedAt', 'value'].sort(),
      );
      expect(opens).toMatchObject({
        category: 'booking_window',
        value: 504,
        unit: 'hours',
        enabled: true,
      });
      expect(new Date(opens.updatedAt).toISOString()).toBe(opens.updatedAt);
      expect(opens.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('states the unit of every numeric rule and uses null for the on/off rules', async () => {
      const res = await request(app).get(BASE).set(as(owner));
      const byKey = Object.fromEntries(allRules(res.body).map((r) => [r.ruleKey, r]));

      expect(byKey.TIMETABLE_VISIBLE_AHEAD).toMatchObject({ value: 21, unit: 'days' });
      expect(byKey.STRIKES_BEFORE_SUSPENSION).toMatchObject({ value: 3, unit: 'count' });
      expect(byKey.LATE_FEE).toMatchObject({ value: 10, unit: 'percent', enabled: false });
      expect(byKey.CLASSPASS_ACCEPT).toMatchObject({ value: null, unit: null, enabled: true });
      expect(byKey.CLIENT_SELF_PAUSE).toMatchObject({ value: null, unit: null, enabled: false });
    });

    it('lets an Admin read', async () => {
      const res = await request(app).get(BASE).set(as(admin));
      expect(res.status).toBe(200);
    });

    it.each([
      ['coach', () => coach],
      ['member', () => member],
    ])('forbids a %s', async (_name, getUser) => {
      const res = await request(app).get(BASE).set(as(getUser()));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    });

    it('requires a token', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('does not return a deleted rule, and keeps its category with an empty list', async () => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'CLASSPASS_ACCEPT' } });

      const res = await request(app).get(BASE).set(as(owner));

      expect(allRules(res.body)).toHaveLength(20);
      const classpass = res.body.data.categories.find((c) => c.category === 'classpass');
      expect(classpass.rules).toEqual([]);
    });
  });

  describe('POST /settings/booking-rules', () => {
    it('creates a deleted rule again from its catalogue defaults', async () => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'LATE_FEE' } });

      const res = await request(app).post(BASE).set(as(owner)).send({ ruleKey: 'LATE_FEE' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.BOOKING_RULE_CREATED_SUCCESS,
        data: {
          ruleKey: 'LATE_FEE',
          category: 'cancellations',
          value: 10,
          unit: 'percent',
          enabled: false,
        },
      });
      expect(await rowOf('LATE_FEE')).not.toBeNull();
      expect(res.headers.location).toBeUndefined();
    });

    it('uses the value and enabled that were sent', async () => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'MAX_CLASSES_PER_WEEK' } });

      const res = await request(app)
        .post(BASE)
        .set(as(owner))
        .send({ ruleKey: 'MAX_CLASSES_PER_WEEK', value: 5, enabled: true });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ value: 5, enabled: true });
    });

    it('creates an on/off rule with null value and unit', async () => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'CLASSPASS_ACCEPT' } });
      const res = await request(app)
        .post(BASE)
        .set(as(owner))
        .send({ ruleKey: 'CLASSPASS_ACCEPT', enabled: true });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ value: null, unit: null, enabled: true });
    });

    it('writes a BOOKING_RULE_CREATED audit row for the Owner', async () => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'LATE_FEE' } });
      await request(app).post(BASE).set(as(owner)).send({ ruleKey: 'LATE_FEE' });

      const rows = await auditRows(AuditAction.BOOKING_RULE_CREATED);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: owner.id,
        actorRole: Role.OWNER,
        details: { ruleKey: 'LATE_FEE', value: 10, enabled: false },
      });
    });

    it('blocks a duplicate with 409 BOOKING_RULE_ALREADY_EXISTS', async () => {
      const res = await request(app).post(BASE).set(as(owner)).send({ ruleKey: 'LATE_FEE' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: 'BOOKING_RULE_ALREADY_EXISTS' });
      expect(await prisma.bookingRule.count({ where: { ruleKey: 'LATE_FEE' } })).toBe(1);
    });

    it.each([
      ['an Admin', () => admin],
      ['a coach', () => coach],
      ['a member', () => member],
    ])('forbids %s and creates nothing', async (_name, getUser) => {
      await prisma.bookingRule.delete({ where: { ruleKey: 'LATE_FEE' } });

      const res = await request(app).post(BASE).set(as(getUser())).send({ ruleKey: 'LATE_FEE' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await rowOf('LATE_FEE')).toBeNull();
    });

    it('requires a token', async () => {
      const res = await request(app).post(BASE).send({ ruleKey: 'LATE_FEE' });
      expect(res.status).toBe(401);
    });

    it.each([
      ['an unknown ruleKey', { ruleKey: 'NOT_A_RULE' }, 'ruleKey'],
      ['no ruleKey', {}, 'ruleKey'],
      ['a value for an on/off rule', { ruleKey: 'CLASSPASS_ACCEPT', value: 1 }, 'value'],
      ['a value above the bounds', { ruleKey: 'BOOKING_WINDOW_OPENS', value: 8761 }, 'value'],
      ['a percent of 0', { ruleKey: 'LATE_FEE', value: 0 }, 'value'],
      ['a fractional value', { ruleKey: 'WAITLIST_MAX_PER_CLASS', value: 2.5 }, 'value'],
      ['a text value', { ruleKey: 'WAITLIST_MAX_PER_CLASS', value: '4' }, 'value'],
      ['a non-boolean enabled', { ruleKey: 'LATE_FEE', enabled: 'yes' }, 'enabled'],
      ['an unknown field', { ruleKey: 'LATE_FEE', name: 'Other' }, 'name'],
    ])('rejects %s with 400 and a field error', async (_label, body, field) => {
      await prisma.bookingRule.deleteMany({ where: { ruleKey: body.ruleKey } });

      const res = await request(app).post(BASE).set(as(owner)).send(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    it('rejects a request with no body', async () => {
      const res = await request(app).post(BASE).set(as(owner));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /settings/booking-rules/:id', () => {
    const patch = async (user, ruleKey, body) =>
      request(app)
        .patch(`${BASE}/${await idOf(ruleKey)}`)
        .set(as(user))
        .send(body);

    it('changes the value', async () => {
      const res = await patch(owner, 'WAITLIST_MAX_PER_CLASS', { value: 6 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.BOOKING_RULE_UPDATED_SUCCESS,
        data: { ruleKey: 'WAITLIST_MAX_PER_CLASS', value: 6, unit: 'count', enabled: true },
      });
      expect((await rowOf('WAITLIST_MAX_PER_CLASS')).value).toBe(6);
    });

    it('turns a rule on and off', async () => {
      const on = await patch(owner, 'LATE_FEE', { enabled: true });
      expect(on.body.data.enabled).toBe(true);
      const off = await patch(owner, 'LATE_FEE', { enabled: false });
      expect(off.body.data.enabled).toBe(false);
    });

    it('changes value and enabled together', async () => {
      const res = await patch(owner, 'MAX_CLASSES_PER_WEEK', { value: 4, enabled: true });
      expect(res.body.data).toMatchObject({ value: 4, enabled: true });
    });

    it('keeps the id, key, category, name and unit', async () => {
      const before = await rowOf('LATE_FEE');
      await patch(owner, 'LATE_FEE', { value: 15 });
      const after = await rowOf('LATE_FEE');
      expect(after).toMatchObject({
        id: before.id,
        ruleKey: before.ruleKey,
        category: before.category,
        name: before.name,
        unit: before.unit,
      });
    });

    it('writes a BOOKING_RULE_UPDATED audit row with the changes', async () => {
      await patch(owner, 'WAITLIST_MAX_PER_CLASS', { value: 6 });

      const rows = await auditRows(AuditAction.BOOKING_RULE_UPDATED);
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toEqual({
        ruleKey: 'WAITLIST_MAX_PER_CLASS',
        changes: { value: { from: 4, to: 6 } },
      });
    });

    it('answers 200 and writes no audit row when nothing changes', async () => {
      const res = await patch(owner, 'WAITLIST_MAX_PER_CLASS', { value: 4, enabled: true });

      expect(res.status).toBe(200);
      expect(await auditRows(AuditAction.BOOKING_RULE_UPDATED)).toHaveLength(0);
    });

    it('accepts the bounds', async () => {
      expect((await patch(owner, 'BOOKING_WINDOW_OPENS', { value: 8760 })).status).toBe(200);
      expect((await patch(owner, 'BOOKING_WINDOW_OPENS', { value: 0 })).status).toBe(200);
      expect((await patch(owner, 'LATE_FEE', { value: 100 })).status).toBe(200);
      expect((await patch(owner, 'LATE_FEE', { value: 1 })).status).toBe(200);
    });

    it.each([
      ['hours above 8760', 'BOOKING_WINDOW_OPENS', { value: 8761 }],
      ['negative hours', 'BOOKING_WINDOW_OPENS', { value: -1 }],
      ['days above 365', 'TIMETABLE_VISIBLE_AHEAD', { value: 366 }],
      ['count above 1000', 'WAITLIST_MAX_PER_CLASS', { value: 1001 }],
      ['percent of 0', 'LATE_FEE', { value: 0 }],
      ['percent above 100', 'LATE_FEE', { value: 101 }],
      ['a fractional value', 'MAX_GUESTS_PER_MEMBER', { value: 1.5 }],
      ['a null value', 'MAX_GUESTS_PER_MEMBER', { value: null }],
      ['a value for an on/off rule', 'CLASSPASS_ACCEPT', { value: 1 }],
      ['a non-boolean enabled', 'LATE_FEE', { enabled: 1 }],
      ['an empty body', 'LATE_FEE', {}],
      ['a name change', 'LATE_FEE', { name: 'Other' }],
      ['a category change', 'LATE_FEE', { category: 'classpass' }],
      ['a unit change', 'LATE_FEE', { unit: 'hours' }],
      ['a ruleKey change', 'LATE_FEE', { ruleKey: 'CREDIT_OVERDRAFT' }],
    ])('rejects %s with 400', async (_label, ruleKey, body) => {
      const before = await rowOf(ruleKey);

      const res = await patch(owner, ruleKey, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(await rowOf(ruleKey)).toMatchObject({ value: before.value, enabled: before.enabled });
    });

    it.each([
      ['an Admin', () => admin],
      ['a coach', () => coach],
      ['a member', () => member],
    ])('forbids %s and changes nothing', async (_name, getUser) => {
      const res = await patch(getUser(), 'WAITLIST_MAX_PER_CLASS', { value: 9 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect((await rowOf('WAITLIST_MAX_PER_CLASS')).value).toBe(4);
    });

    it('requires a token', async () => {
      const res = await request(app)
        .patch(`${BASE}/${await idOf('LATE_FEE')}`)
        .send({ enabled: true });
      expect(res.status).toBe(401);
    });

    it('answers 400 for a malformed id', async () => {
      const res = await request(app)
        .patch(`${BASE}/not-a-uuid`)
        .set(as(owner))
        .send({ enabled: true });
      expect(res.status).toBe(400);
      expect(res.body.errors[0]).toMatchObject({ field: 'id' });
    });

    it('answers 404 BOOKING_RULE_NOT_FOUND for an unknown id', async () => {
      const res = await request(app)
        .patch(`${BASE}/${crypto.randomUUID()}`)
        .set(as(owner))
        .send({ enabled: true });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: 'BOOKING_RULE_NOT_FOUND' });
    });
  });

  describe('DELETE /settings/booking-rules/:id', () => {
    it('deletes the rule and stops returning it', async () => {
      const id = await idOf('MAX_GUESTS_PER_MEMBER');

      const res = await request(app).delete(`${BASE}/${id}`).set(as(owner));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: Messages.BOOKING_RULE_DELETED_SUCCESS,
        data: null,
      });
      expect(await rowOf('MAX_GUESTS_PER_MEMBER')).toBeNull();
      const list = await request(app).get(BASE).set(as(owner));
      expect(allRules(list.body).map((r) => r.ruleKey)).not.toContain('MAX_GUESTS_PER_MEMBER');
    });

    it('writes a BOOKING_RULE_DELETED audit row', async () => {
      await request(app)
        .delete(`${BASE}/${await idOf('LATE_FEE')}`)
        .set(as(owner));

      const rows = await auditRows(AuditAction.BOOKING_RULE_DELETED);
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toEqual({ ruleKey: 'LATE_FEE', value: 10, enabled: false });
    });

    it('answers 404 the second time', async () => {
      const id = await idOf('LATE_FEE');
      await request(app).delete(`${BASE}/${id}`).set(as(owner));

      const res = await request(app).delete(`${BASE}/${id}`).set(as(owner));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOKING_RULE_NOT_FOUND');
    });

    it.each([
      ['an Admin', () => admin],
      ['a coach', () => coach],
      ['a member', () => member],
    ])('forbids %s and deletes nothing', async (_name, getUser) => {
      const res = await request(app)
        .delete(`${BASE}/${await idOf('LATE_FEE')}`)
        .set(as(getUser()));

      expect(res.status).toBe(403);
      expect(await rowOf('LATE_FEE')).not.toBeNull();
    });

    it('requires a token', async () => {
      const res = await request(app).delete(`${BASE}/${await idOf('LATE_FEE')}`);
      expect(res.status).toBe(401);
    });

    it('answers 400 for a malformed id', async () => {
      const res = await request(app).delete(`${BASE}/123`).set(as(owner));
      expect(res.status).toBe(400);
    });

    it('lets the Owner create the rule again after deleting it', async () => {
      await request(app)
        .delete(`${BASE}/${await idOf('LATE_FEE')}`)
        .set(as(owner));
      const res = await request(app).post(BASE).set(as(owner)).send({ ruleKey: 'LATE_FEE' });
      expect(res.status).toBe(201);
    });
  });

  describe('wrong methods', () => {
    it.each([
      ['PUT', BASE, 'GET, POST'],
      ['PATCH', BASE, 'GET, POST'],
      ['DELETE', BASE, 'GET, POST'],
      ['GET', `${BASE}/${crypto.randomUUID()}`, 'PATCH, DELETE'],
      ['POST', `${BASE}/${crypto.randomUUID()}`, 'PATCH, DELETE'],
      ['PUT', `${BASE}/${crypto.randomUUID()}`, 'PATCH, DELETE'],
    ])('%s %s answers 405 with Allow: %s', async (method, url, allow) => {
      const res = await request(app)[method.toLowerCase()](url).set(as(owner));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe(allow);
      expect(res.body).toMatchObject({ success: false, code: 'METHOD_NOT_ALLOWED' });
    });
  });

  describe('reading rules for enforcement', () => {
    it('getRule returns a saved rule and null once it is deleted', async () => {
      expect(await getRule('WAITLIST_MAX_PER_CLASS')).toMatchObject({ value: 4 });
      await prisma.bookingRule.delete({ where: { ruleKey: 'WAITLIST_MAX_PER_CLASS' } });
      expect(await getRule('WAITLIST_MAX_PER_CLASS')).toBeNull();
    });

    it('isFeatureEnabled is true when enabled, false when disabled or deleted', async () => {
      expect(await isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(true);
      await prisma.bookingRule.update({
        where: { ruleKey: 'CLASSPASS_ACCEPT' },
        data: { enabled: false },
      });
      expect(await isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(false);
      await prisma.bookingRule.update({
        where: { ruleKey: 'CLASSPASS_ACCEPT' },
        data: { enabled: true },
      });
      expect(await isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(true);
      await prisma.bookingRule.delete({ where: { ruleKey: 'CLASSPASS_ACCEPT' } });
      expect(await isFeatureEnabled('CLASSPASS_ACCEPT')).toBe(false);
    });

    it('isFeatureEnabled is false for a feature that is off by default', async () => {
      expect(await isFeatureEnabled('CLIENT_SELF_PAUSE')).toBe(false);
    });

    it('getLimitValue is null (no restriction) when disabled or deleted', async () => {
      expect(await getLimitValue('MAX_CLASSES_PER_WEEK')).toBeNull();
      await prisma.bookingRule.update({
        where: { ruleKey: 'MAX_CLASSES_PER_WEEK' },
        data: { enabled: true },
      });
      expect(await getLimitValue('MAX_CLASSES_PER_WEEK')).toBe(2);
      await prisma.bookingRule.delete({ where: { ruleKey: 'MAX_CLASSES_PER_WEEK' } });
      expect(await getLimitValue('MAX_CLASSES_PER_WEEK')).toBeNull();
    });
  });
});
