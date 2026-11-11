const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(120000);

const URL = '/api/v1/notifications';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('notifications: /api/v1/notifications (own notifications only, any role)', () => {
  const testData = createTestData('notif');
  let app;
  let admin;
  let owner;
  let coach;
  let member;
  let other;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coach = (await testData.createCoach()).user;
    member = await testData.createUser({ role: Role.MEMBER });
    other = await testData.createUser({ role: Role.MEMBER });
  });

  const everyone = () => [admin, owner, coach, member, other];
  afterEach(() =>
    prisma.notification.deleteMany({ where: { userId: { in: everyone().map((u) => u.id) } } }),
  );
  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const as = (caller) => ({ Authorization: bearerFor(caller) });
  const get = (caller, url) => request(app).get(url).set(as(caller));

  // createdAt is spread out so the "newest first" order is certain.
  let tick = 0;
  const seed = (user, overrides = {}) => {
    tick += 1;
    return prisma.notification.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        type: 'CLASS_CANCELLED',
        title: `Title ${tick}`,
        body: `Body ${tick}`,
        data: { sessionId: 's', classId: 'c', startAt: '2030-01-01T00:00:00.000Z' },
        createdAt: new Date(Date.now() - 100000 + tick * 1000),
        ...overrides,
      },
    });
  };

  describe('GET /notifications', () => {
    it('lists only the caller notifications, newest first, with the documented fields', async () => {
      const first = await seed(member);
      const second = await seed(member, { readAt: new Date() });
      await seed(other);

      const res = await get(member, URL);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((n) => n.id)).toEqual([second.id, first.id]);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(Object.keys(res.body.data[0]).sort()).toEqual(
        ['body', 'createdAt', 'data', 'id', 'readAt', 'title', 'type'].sort(),
      );
      expect(res.body.data[0].readAt).toMatch(ISO_UTC);
      expect(res.body.data[1].readAt).toBeNull(); // explicit null
      expect(res.body.data[0].createdAt).toMatch(ISO_UTC);
      expect(res.body.data[0].data).toEqual({
        sessionId: 's',
        classId: 'c',
        startAt: '2030-01-01T00:00:00.000Z',
      });
    });

    it('?unread=true keeps only unread; paging works', async () => {
      const a = await seed(member);
      await seed(member, { readAt: new Date() });
      const c = await seed(member);

      const unread = await get(member, `${URL}?unread=true`);
      expect(unread.body.data.map((n) => n.id)).toEqual([c.id, a.id]);
      expect(unread.body.pagination.total).toBe(2);

      const paged = await get(member, `${URL}?limit=1&page=2`);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.pagination).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3 });
    });

    it('every role reads its own: admin, owner, coach and member', async () => {
      for (const user of [admin, owner, coach, member]) {
        const mine = await seed(user);
        const res = await get(user, URL);
        expect(res.status).toBe(200);
        expect(res.body.data.map((n) => n.id)).toEqual([mine.id]);
      }
    });

    it('400 for bad parameters, 401 without a token', async () => {
      expect((await get(member, `${URL}?unread=maybe`)).status).toBe(400);
      expect((await get(member, `${URL}?limit=101`)).status).toBe(400);
      expect((await get(member, `${URL}?bogus=1`)).status).toBe(400);
      expect((await request(app).get(URL)).status).toBe(401);
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('counts only the unread rows of the caller', async () => {
      await seed(member);
      await seed(member);
      await seed(member, { readAt: new Date() });
      await seed(other);
      const res = await get(member, `${URL}/unread-count`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ unreadCount: 2 });
      expect((await get(coach, `${URL}/unread-count`)).body.data).toEqual({ unreadCount: 0 });
    });

    it('401 without a token, 400 for a query parameter', async () => {
      expect((await request(app).get(`${URL}/unread-count`)).status).toBe(401);
      expect((await get(member, `${URL}/unread-count?page=1`)).status).toBe(400);
    });
  });

  describe('PATCH /notifications/:notificationId/read', () => {
    it('marks one as read, keeps the first read time on a repeat (idempotent)', async () => {
      const n = await seed(member);
      const first = await request(app).patch(`${URL}/${n.id}/read`).set(as(member));
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ id: n.id });
      expect(first.body.data.readAt).toMatch(ISO_UTC);

      const second = await request(app).patch(`${URL}/${n.id}/read`).set(as(member));
      expect(second.status).toBe(200);
      expect(second.body.data.readAt).toBe(first.body.data.readAt);
      expect((await get(member, `${URL}/unread-count`)).body.data.unreadCount).toBe(0);
    });

    it("somebody else's notification and an unknown id are 404 and the row is untouched", async () => {
      const n = await seed(other);
      const foreign = await request(app).patch(`${URL}/${n.id}/read`).set(as(member));
      expect([foreign.status, foreign.body.code]).toEqual([404, 'NOTIFICATION_NOT_FOUND']);
      expect((await prisma.notification.findUnique({ where: { id: n.id } })).readAt).toBeNull();
      const unknown = await request(app).patch(`${URL}/${MISSING_ID}/read`).set(as(member));
      expect([unknown.status, unknown.body.code]).toEqual([404, 'NOTIFICATION_NOT_FOUND']);
    });

    it('400 for a bad id, 401 without a token', async () => {
      expect((await request(app).patch(`${URL}/nope/read`).set(as(member))).status).toBe(400);
      expect((await request(app).patch(`${URL}/${MISSING_ID}/read`)).status).toBe(401);
    });
  });

  describe('POST /notifications/read-all', () => {
    it('marks all unread of the caller only, and reports the count', async () => {
      await seed(member);
      await seed(member);
      await seed(member, { readAt: new Date('2030-01-01T00:00:00.000Z') });
      const theirs = await seed(other);

      const res = await request(app).post(`${URL}/read-all`).set(as(member));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updatedCount: 2 });
      expect((await get(member, `${URL}/unread-count`)).body.data.unreadCount).toBe(0);
      expect(
        (await prisma.notification.findUnique({ where: { id: theirs.id } })).readAt,
      ).toBeNull();

      const again = await request(app).post(`${URL}/read-all`).set(as(member));
      expect(again.body.data).toEqual({ updatedCount: 0 });
    });

    it('401 without a token', async () => {
      expect((await request(app).post(`${URL}/read-all`)).status).toBe(401);
    });
  });

  describe('methods and routing', () => {
    it('405 with an Allow header on each path', async () => {
      const id = MISSING_ID;
      expect((await request(app).post(URL).set(as(member)).send({})).headers.allow).toBe('GET');
      expect((await request(app).delete(`${URL}/unread-count`).set(as(member))).headers.allow).toBe(
        'GET',
      );
      expect((await get(member, `${URL}/read-all`)).headers.allow).toBe('POST');
      expect((await get(member, `${URL}/${id}/read`)).headers.allow).toBe('PATCH');
    });

    it('/unread-count and /read-all are not read as a notification id', async () => {
      expect((await get(member, `${URL}/unread-count`)).status).toBe(200);
      expect((await request(app).post(`${URL}/read-all`).set(as(member))).status).toBe(200);
    });
  });
});
