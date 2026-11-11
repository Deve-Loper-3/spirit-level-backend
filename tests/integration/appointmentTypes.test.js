const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const URL = '/api/v1/appointment-types';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PREFIX = `test_apt_type_${Date.now()}_`;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('appointment types: /api/v1/appointment-types', () => {
  const testData = createTestData('apt_types');
  let app;
  let admin;
  let owner;
  let member;
  let coachUser;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    member = await testData.createUser({ role: Role.MEMBER });
    coachUser = (await testData.createCoach()).user;
  });

  const cleanTypes = () =>
    prisma.appointmentType.deleteMany({ where: { name: { startsWith: PREFIX } } });
  const cleanAudit = () =>
    prisma.auditLog.deleteMany({ where: { actorId: { in: [admin.id, owner.id] } } });

  afterEach(async () => {
    await cleanTypes();
    await cleanAudit();
  });

  afterAll(async () => {
    await cleanTypes();
    await cleanAudit();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const get = (caller, url) => request(app).get(url).set(as(caller));
  const post = (caller, body) => request(app).post(URL).set(as(caller)).send(body);
  const patch = (caller, id, body) => request(app).patch(`${URL}/${id}`).set(as(caller)).send(body);

  const body = (overrides = {}) => ({
    name: `${PREFIX}PT 60`,
    durationMin: 60,
    bufferBeforeMin: 5,
    bufferAfterMin: 10,
    ...overrides,
  });

  const createType = async (overrides = {}) => {
    const res = await post(admin, body(overrides));
    expect(res.status).toBe(201);
    return res.body.data;
  };

  describe('POST', () => {
    it('creates a type: round trip with defaults, ISO timestamps and an audit row', async () => {
      const res = await post(admin, { name: `  ${PREFIX}Intro  `, durationMin: 30 });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        name: `${PREFIX}Intro`,
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        isActive: true,
      });
      expect(res.body.data.createdAt).toMatch(ISO_UTC);

      const stored = await prisma.appointmentType.findUnique({ where: { id: res.body.data.id } });
      expect(stored.name).toBe(`${PREFIX}Intro`);

      const audit = await prisma.auditLog.findMany({
        where: { actorId: admin.id, action: AuditAction.APPOINTMENT_TYPE_CREATED },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({ appointmentTypeId: res.body.data.id });
    });

    it('OWNER can create too', async () => {
      const res = await post(owner, body());
      expect(res.status).toBe(201);
    });

    it('409 for a duplicate ACTIVE name, ignoring case and surrounding spaces', async () => {
      await createType({ name: `${PREFIX}Same` });
      const res = await post(admin, body({ name: `  ${PREFIX.toUpperCase()}SAME ` }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPOINTMENT_TYPE_NAME_TAKEN');
    });

    it('the name of an INACTIVE type can be reused', async () => {
      const first = await createType({ name: `${PREFIX}Reuse`, isActive: false });
      expect(first.isActive).toBe(false);
      const second = await post(admin, body({ name: `${PREFIX}Reuse` }));
      expect(second.status).toBe(201);
    });

    it.each([
      ['blank name', { name: '   ' }],
      ['duration 0', { durationMin: 0 }],
      ['duration 481', { durationMin: 481 }],
      ['negative buffer', { bufferBeforeMin: -1 }],
      ['buffer 241', { bufferAfterMin: 241 }],
      ['unknown field', { color: 'red' }],
    ])('400 for %s', async (_label, overrides) => {
      const res = await post(admin, body(overrides));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('403 for a coach and a member, 401 without a token', async () => {
      expect((await post(coachUser, body())).status).toBe(403);
      expect((await post(member, body())).status).toBe(403);
      expect((await request(app).post(URL).send(body())).status).toBe(401);
    });
  });

  describe('PATCH', () => {
    it('edits any subset and audits before / after', async () => {
      const type = await createType();
      const res = await patch(admin, type.id, { durationMin: 45, bufferAfterMin: 0 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: type.id, durationMin: 45, bufferAfterMin: 0 });
      expect(res.body.data.name).toBe(type.name);

      const audit = await prisma.auditLog.findMany({
        where: { actorId: admin.id, action: AuditAction.APPOINTMENT_TYPE_UPDATED },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({
        appointmentTypeId: type.id,
        before: { durationMin: 60, bufferAfterMin: 10 },
        after: { durationMin: 45, bufferAfterMin: 0 },
      });
    });

    it('deactivates (isActive=false) and re-activates a type', async () => {
      const type = await createType();
      expect((await patch(admin, type.id, { isActive: false })).body.data.isActive).toBe(false);
      expect((await patch(admin, type.id, { isActive: true })).body.data.isActive).toBe(true);
    });

    it('409 when renaming onto another active name, and when re-activating a clashing name', async () => {
      await createType({ name: `${PREFIX}A` });
      const b = await createType({ name: `${PREFIX}B` });
      const clash = await patch(admin, b.id, { name: `${PREFIX}a` });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('APPOINTMENT_TYPE_NAME_TAKEN');

      await patch(admin, b.id, { isActive: false });
      await createType({ name: `${PREFIX}B` });
      const reactivate = await patch(admin, b.id, { isActive: true });
      expect(reactivate.status).toBe(409);
    });

    it('renaming to its own name (other case) is allowed', async () => {
      const type = await createType({ name: `${PREFIX}Own` });
      const res = await patch(admin, type.id, { name: `${PREFIX.toUpperCase()}OWN` });
      expect(res.status).toBe(200);
    });

    it('400 for an empty body, a bad value and a bad id; 404 for an unknown id', async () => {
      const type = await createType();
      const empty = await patch(admin, type.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.errors[0].field).toBe('body');
      expect((await patch(admin, type.id, { durationMin: 0 })).status).toBe(400);
      expect((await patch(admin, 'not-a-uuid', { isActive: false })).status).toBe(400);
      const missing = await patch(admin, MISSING_ID, { isActive: false });
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('APPOINTMENT_TYPE_NOT_FOUND');
    });

    it('403 for a coach and a member', async () => {
      const type = await createType();
      expect((await patch(coachUser, type.id, { isActive: false })).status).toBe(403);
      expect((await patch(member, type.id, { isActive: false })).status).toBe(403);
    });
  });

  describe('GET', () => {
    it('lists with pagination, sorted by name, and filters by isActive for managers', async () => {
      await createType({ name: `${PREFIX}b` });
      await createType({ name: `${PREFIX}a` });
      await createType({ name: `${PREFIX}c`, isActive: false });

      const all = await get(admin, `${URL}?limit=100`);
      expect(all.status).toBe(200);
      const mine = all.body.data.filter((t) => t.name.startsWith(PREFIX));
      expect(mine.map((t) => t.name)).toEqual([`${PREFIX}a`, `${PREFIX}b`, `${PREFIX}c`]);
      expect(all.body.pagination).toMatchObject({ page: 1, limit: 100 });

      const inactive = await get(owner, `${URL}?isActive=false&limit=100`);
      expect(inactive.body.data.every((t) => t.isActive === false)).toBe(true);
      expect(inactive.body.data.some((t) => t.name === `${PREFIX}c`)).toBe(true);

      const paged = await get(admin, `${URL}?limit=1&page=2`);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.pagination.page).toBe(2);
    });

    it('a coach and a member see active types only, even with isActive=false', async () => {
      await createType({ name: `${PREFIX}on` });
      await createType({ name: `${PREFIX}off`, isActive: false });
      for (const caller of [coachUser, member]) {
        const res = await get(caller, `${URL}?isActive=false&limit=100`);
        expect(res.status).toBe(200);
        expect(res.body.data.every((t) => t.isActive)).toBe(true);
        const names = res.body.data.map((t) => t.name);
        expect(names).toContain(`${PREFIX}on`);
        expect(names).not.toContain(`${PREFIX}off`);
      }
    });

    it('400 for a bad filter or an unknown parameter; 401 without a token', async () => {
      expect((await get(admin, `${URL}?isActive=maybe`)).status).toBe(400);
      expect((await get(admin, `${URL}?sort=name`)).status).toBe(400);
      expect((await request(app).get(URL)).status).toBe(401);
    });
  });

  describe('methods', () => {
    it('DELETE is 405 with an Allow header (a type is deactivated, never deleted)', async () => {
      const type = await createType();
      const res = await request(app).delete(`${URL}/${type.id}`).set(as(admin));
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('PATCH');
      expect((await request(app).put(URL).set(as(admin)).send({})).headers.allow).toBe('GET, POST');
    });
  });
});
