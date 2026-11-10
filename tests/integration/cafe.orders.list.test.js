const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestCafeOrder, deleteTestCafeOrders } = require('../helpers/cafeOrder.helper');

jest.setTimeout(60000);

// SLAPP-79/82 phase 1. The DB is shared, so admin cases narrow with `search=<prefix>` and coach
// cases rely on freshly created users who own nothing else.
describe('GET /api/v1/cafe/orders', () => {
  const PREFIX = 'TLST-';
  const URL = '/api/v1/cafe/orders';
  const testData = createTestData('cafe_ord_list');
  let app;
  let admin;
  let owner;
  let coachA;
  let coachB;
  let member;

  const get = (user, query = {}) =>
    request(app).get(URL).query(query).set('Authorization', bearerFor(user));

  beforeAll(async () => {
    app = createApp();
    await deleteTestCafeOrders(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coachA = await testData.createUser({ role: Role.COACH, fullName: 'Coach A' });
    coachB = await testData.createUser({ role: Role.COACH, fullName: 'Coach B' });
    member = await testData.createUser({ role: Role.MEMBER });
  });

  afterEach(async () => {
    await deleteTestCafeOrders(PREFIX);
  });

  afterAll(async () => {
    await deleteTestCafeOrders(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('auth and roles', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get(URL);
      expect(res.status).toBe(401);
    });

    it('returns 403 for MEMBER', async () => {
      const res = await get(member);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.FORBIDDEN.code);
    });

    it.each([
      ['ADMIN', () => admin],
      ['OWNER', () => owner],
      ['COACH', () => coachA],
    ])('returns 200 for %s', async (_role, getUser) => {
      const res = await get(getUser());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 405 for POST (order creation is out of scope)', async () => {
      const res = await request(app).post(URL).set('Authorization', bearerFor(admin)).send({});
      expect(res.status).toBe(405);
    });
  });

  describe('visibility', () => {
    beforeEach(async () => {
      await createTestCafeOrder(PREFIX, { createdById: coachA.id });
      await createTestCafeOrder(PREFIX, { createdById: coachA.id });
      await createTestCafeOrder(PREFIX, { createdById: coachB.id });
    });

    it('a staff member sees only orders they created', async () => {
      const res = await get(coachA);
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.data.every((o) => o.createdBy.id === coachA.id)).toBe(true);
    });

    it('a staff member with no orders sees an empty list', async () => {
      const coachC = await testData.createUser({ role: Role.COACH });
      const res = await get(coachC);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it.each([
      ['ADMIN', () => admin],
      ['OWNER', () => owner],
    ])('%s sees every staff member’s orders', async (_role, getUser) => {
      const res = await get(getUser(), { search: PREFIX });
      expect(res.body.pagination.total).toBe(3);
      const creators = new Set(res.body.data.map((o) => o.createdBy.id));
      expect(creators).toEqual(new Set([coachA.id, coachB.id]));
    });

    it.each(['userId', 'createdBy', 'createdById', 'user_id', 'source'])(
      'rejects the `%s` query parameter with 400 instead of widening scope',
      async (param) => {
        const res = await get(coachA, { [param]: coachB.id });
        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([
          expect.objectContaining({ field: param, message: 'Unknown query parameter' }),
        ]);
      },
    );

    it('ignores identity fields in the request body', async () => {
      const res = await request(app)
        .get(URL)
        .set('Authorization', bearerFor(coachA))
        .send({ userId: coachB.id, createdById: coachB.id });
      expect(res.body.pagination.total).toBe(2);
    });
  });

  describe('response shape', () => {
    it('returns list fields with lowercase status and not_tracked payment status', async () => {
      await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        customerName: 'Layla',
        items: [
          { itemName: 'Latte', unitPriceAed: '17.50', quantity: 2 },
          { itemName: 'Brownie', unitPriceAed: '12.00', quantity: 1 },
        ],
      });

      const res = await get(coachA);
      const [order] = res.body.data;
      expect(Object.keys(order).sort()).toEqual(
        [
          'id',
          'orderNumber',
          'status',
          'customerName',
          'totalAed',
          'paymentStatus',
          'createdBy',
          'itemCount',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(order).toMatchObject({
        status: 'preparing',
        customerName: 'Layla',
        totalAed: 47,
        paymentStatus: 'not_tracked',
        createdBy: { id: coachA.id, fullName: 'Coach A' },
        itemCount: 2,
      });
    });

    it('orders newest first', async () => {
      const older = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        createdAt: new Date('2004-01-01T08:00:00Z'),
      });
      const newer = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        createdAt: new Date('2004-01-02T08:00:00Z'),
      });
      const res = await get(coachA);
      expect(res.body.data.map((o) => o.id)).toEqual([newer.id, older.id]);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      for (let i = 0; i < 23; i += 1) {
        await createTestCafeOrder(PREFIX, { createdById: coachA.id });
      }
    });

    it('defaults to page 1 and limit 20', async () => {
      const res = await get(coachA);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 23, totalPages: 2 });
    });

    it('returns the remainder on the last page', async () => {
      const res = await get(coachA, { page: 2 });
      expect(res.body.data).toHaveLength(3);
    });

    it('returns an empty page past the end', async () => {
      const res = await get(coachA, { page: 5 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(23);
    });

    it('pages do not overlap', async () => {
      const p1 = await get(coachA, { limit: 10, page: 1 });
      const p2 = await get(coachA, { limit: 10, page: 2 });
      const ids = [...p1.body.data, ...p2.body.data].map((o) => o.id);
      expect(new Set(ids).size).toBe(20);
    });

    it('accepts limit=100', async () => {
      const res = await get(coachA, { limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(23);
    });

    it.each([{ limit: 101 }, { limit: 0 }, { limit: 'abc' }, { page: 0 }, { page: -1 }])(
      'rejects %o with 400',
      async (query) => {
        const res = await get(coachA, query);
        expect(res.status).toBe(400);
      },
    );
  });

  describe('filters', () => {
    it('filters by status', async () => {
      await createTestCafeOrder(PREFIX, { createdById: coachA.id, status: 'PREPARING' });
      await createTestCafeOrder(PREFIX, { createdById: coachA.id, status: 'READY' });
      await createTestCafeOrder(PREFIX, { createdById: coachA.id, status: 'SERVED' });

      for (const status of ['preparing', 'ready', 'served']) {
        const res = await get(coachA, { status });
        expect(res.body.data.map((o) => o.status)).toEqual([status]);
      }
    });

    it.each(['PREPARING', 'cancelled', 'paid'])('rejects status=%s with 400', async (status) => {
      const res = await get(coachA, { status });
      expect(res.status).toBe(400);
    });

    // Dubai is UTC+4 with no DST: local midnight on 2003-03-11 is 2003-03-10T20:00Z.
    it('applies from/to as inclusive facility-local days', async () => {
      const lastMsOfTenth = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        createdAt: new Date('2003-03-10T19:59:59.999Z'),
      });
      const firstMsOfEleventh = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        createdAt: new Date('2003-03-10T20:00:00.000Z'),
      });
      const firstMsOfTenth = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        createdAt: new Date('2003-03-09T20:00:00.000Z'),
      });

      const tenth = await get(coachA, { from: '2003-03-10', to: '2003-03-10' });
      expect(tenth.body.data.map((o) => o.id).sort()).toEqual(
        [lastMsOfTenth.id, firstMsOfTenth.id].sort(),
      );

      const fromEleventh = await get(coachA, { from: '2003-03-11' });
      expect(fromEleventh.body.data.map((o) => o.id)).toEqual([firstMsOfEleventh.id]);

      const toNinth = await get(coachA, { to: '2003-03-09' });
      expect(toNinth.body.data).toEqual([]);
    });

    it.each([
      [{ from: '2003-13-01' }, 'from'],
      [{ from: '2003-02-30' }, 'from'],
      [{ to: '10/03/2003' }, 'to'],
      [{ from: '2003-03-11', to: '2003-03-10' }, 'from'],
    ])('rejects %o with 400 on %s', async (query, field) => {
      const res = await get(coachA, query);
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    describe('search', () => {
      let byNumber;
      let byCustomer;
      let byItem;

      beforeEach(async () => {
        byNumber = await createTestCafeOrder(PREFIX, {
          createdById: coachA.id,
          orderNumber: `${PREFIX}ZX9001`,
          items: [{ itemName: 'Espresso', unitPriceAed: '12.00', quantity: 1 }],
        });
        byCustomer = await createTestCafeOrder(PREFIX, {
          createdById: coachA.id,
          customerName: 'Fatima Al Zahra',
          items: [{ itemName: 'Espresso', unitPriceAed: '12.00', quantity: 1 }],
        });
        byItem = await createTestCafeOrder(PREFIX, {
          createdById: coachA.id,
          items: [
            { itemName: 'Espresso', unitPriceAed: '12.00', quantity: 1 },
            { itemName: 'Matcha 100% Oat', unitPriceAed: '22.00', quantity: 1 },
          ],
        });
      });

      it.each([
        ['order number', 'zx9001', () => byNumber],
        ['customer name', 'al zahra', () => byCustomer],
        ['item name', 'MATCHA', () => byItem],
      ])('matches %s case-insensitively', async (_label, search, getExpected) => {
        const res = await get(coachA, { search });
        expect(res.body.data.map((o) => o.id)).toEqual([getExpected().id]);
      });

      it('returns an order once even when several items match', async () => {
        const res = await get(coachA, { search: 'espresso' });
        expect(res.body.pagination.total).toBe(3);
      });

      it('treats % and _ literally', async () => {
        expect((await get(coachA, { search: '100%' })).body.data).toHaveLength(1);
        expect((await get(coachA, { search: '%' })).body.data).toHaveLength(1);
        expect((await get(coachA, { search: '_' })).body.data).toHaveLength(0);
      });

      it('does not let search reach another user’s orders', async () => {
        await createTestCafeOrder(PREFIX, { createdById: coachB.id, customerName: 'Fatima B' });
        const res = await get(coachA, { search: 'fatima' });
        expect(res.body.data.map((o) => o.id)).toEqual([byCustomer.id]);
      });

      it('rejects a search longer than 100 characters', async () => {
        const res = await get(coachA, { search: 'x'.repeat(101) });
        expect(res.status).toBe(400);
      });
    });

    it('combines status, date range and search', async () => {
      const hit = await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        status: 'READY',
        customerName: 'Omar',
        createdAt: new Date('2003-05-05T10:00:00Z'),
      });
      await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        status: 'PREPARING',
        customerName: 'Omar',
        createdAt: new Date('2003-05-05T10:00:00Z'),
      });
      await createTestCafeOrder(PREFIX, {
        createdById: coachA.id,
        status: 'READY',
        customerName: 'Omar',
        createdAt: new Date('2003-06-05T10:00:00Z'),
      });

      const res = await get(coachA, {
        status: 'ready',
        search: 'omar',
        from: '2003-05-01',
        to: '2003-05-31',
      });
      expect(res.body.data.map((o) => o.id)).toEqual([hit.id]);
    });
  });
});
