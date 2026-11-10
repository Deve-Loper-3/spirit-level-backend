const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const { AuditAction } = require('../../src/constants/audit');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestCafeOrder, deleteTestCafeOrders } = require('../helpers/cafeOrder.helper');

jest.setTimeout(60000);

// SLAPP-79/82 phase 2: PATCH /api/v1/cafe/orders/:orderId/status.
describe('PATCH /api/v1/cafe/orders/:orderId/status', () => {
  const PREFIX = 'TSTS-';
  const url = (id) => `/api/v1/cafe/orders/${id}/status`;
  const testData = createTestData('cafe_ord_status');
  let app;
  let admin;
  let owner;
  let coach;
  let member;

  const patch = (user, id, body) =>
    request(app).patch(url(id)).set('Authorization', bearerFor(user)).send(body);

  const newOrder = (status = 'PREPARING') =>
    createTestCafeOrder(PREFIX, {
      createdById: coach.id,
      status,
      customerName: 'Huda',
      items: [
        { itemName: 'Cortado', unitPriceAed: '16.50', quantity: 2 },
        { itemName: 'Date Bar', unitPriceAed: '9.00', quantity: 1 },
      ],
    });

  // Everything except status/updatedAt, straight from the DB.
  const snapshot = async (id) => {
    const row = await prisma.cafeOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    const { status, updatedAt, ...rest } = row;
    return { status, updatedAt, rest: JSON.parse(JSON.stringify(rest)) };
  };

  const auditRowsFor = (orderId) =>
    prisma.auditLog.findMany({
      where: {
        action: AuditAction.CAFE_ORDER_STATUS_CHANGED,
        details: { path: ['orderId'], equals: orderId },
      },
      orderBy: { createdAt: 'asc' },
    });

  const cleanupAudits = () =>
    prisma.auditLog.deleteMany({
      where: {
        action: AuditAction.CAFE_ORDER_STATUS_CHANGED,
        actorId: { in: [admin?.id, owner?.id].filter(Boolean) },
      },
    });

  beforeAll(async () => {
    app = createApp();
    await deleteTestCafeOrders(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coach = await testData.createUser({ role: Role.COACH });
    member = await testData.createUser({ role: Role.MEMBER });
  });

  afterEach(async () => {
    await cleanupAudits();
    await deleteTestCafeOrders(PREFIX);
  });

  afterAll(async () => {
    await cleanupAudits();
    await deleteTestCafeOrders(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('auth and roles', () => {
    it('401 without a token, and nothing changes', async () => {
      const order = await newOrder();
      const res = await request(app).patch(url(order.id)).send({ status: 'ready' });
      expect(res.status).toBe(401);
      expect((await snapshot(order.id)).status).toBe('PREPARING');
    });

    it.each([
      ['COACH (even the creator)', () => coach],
      ['MEMBER', () => member],
    ])('403 for %s, and nothing changes', async (_label, getUser) => {
      const order = await newOrder();
      const res = await patch(getUser(), order.id, { status: 'ready' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.FORBIDDEN.code);
      expect((await snapshot(order.id)).status).toBe('PREPARING');
      expect(await auditRowsFor(order.id)).toHaveLength(0);
    });

    it.each([
      ['ADMIN', () => admin],
      ['OWNER', () => owner],
    ])('200 for %s', async (_label, getUser) => {
      const order = await newOrder();
      const res = await patch(getUser(), order.id, { status: 'ready' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ready');
    });
  });

  describe('allowed transitions', () => {
    it('preparing -> ready -> served, returning the full detail shape', async () => {
      const order = await newOrder();

      const toReady = await patch(admin, order.id, { status: 'ready' });
      expect(toReady.status).toBe(200);
      expect(toReady.body.success).toBe(true);
      expect(toReady.body.message).toBe('Order status updated successfully');

      const toServed = await patch(owner, order.id, { status: 'served' });
      expect(toServed.status).toBe(200);

      const detail = await request(app)
        .get(`/api/v1/cafe/orders/${order.id}`)
        .set('Authorization', bearerFor(admin));
      // Same body as GET /orders/:orderId (all fields present, nulls kept).
      expect(toServed.body.data).toEqual(detail.body.data);
      expect(Object.keys(toServed.body.data).sort()).toEqual(
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
          'items',
        ].sort(),
      );
      expect(toServed.body.data).toMatchObject({
        status: 'served',
        paymentStatus: 'not_tracked',
        totalAed: 42,
        itemCount: 2,
      });
    });

    it('keeps customerName null in the response when the order has none', async () => {
      const order = await createTestCafeOrder(PREFIX, { createdById: coach.id });
      const res = await patch(admin, order.id, { status: 'ready' });
      expect(res.body.data).toHaveProperty('customerName', null);
    });

    it('changes only status and updatedAt: payment status, totals and items stay the same', async () => {
      const order = await newOrder();
      const before = await snapshot(order.id);

      await patch(admin, order.id, { status: 'ready' }).expect(200);
      const afterReady = await snapshot(order.id);
      await patch(admin, order.id, { status: 'served' }).expect(200);
      const afterServed = await snapshot(order.id);

      expect(afterReady.rest).toEqual(before.rest);
      expect(afterServed.rest).toEqual(before.rest);
      expect(afterServed.rest.paymentStatus).toBe('NOT_TRACKED');
      expect(afterServed.rest.totalAed).toBe('42');
      expect(afterServed.rest.items).toHaveLength(2);
      expect(afterReady.status).toBe('READY');
      expect(afterServed.status).toBe('SERVED');
      expect(afterReady.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(afterServed.updatedAt.getTime()).toBeGreaterThanOrEqual(
        afterReady.updatedAt.getTime(),
      );
    });
  });

  describe('rejected transitions (409)', () => {
    it.each([
      ['PREPARING', 'served', 'preparing', ['ready']],
      ['PREPARING', 'preparing', 'preparing', ['ready']],
      ['READY', 'preparing', 'ready', ['served']],
      ['READY', 'ready', 'ready', ['served']],
      ['SERVED', 'preparing', 'served', []],
      ['SERVED', 'ready', 'served', []],
      ['SERVED', 'served', 'served', []],
    ])('%s -> %s', async (dbStatus, to, from, allowed) => {
      const order = await newOrder(dbStatus);
      const before = await snapshot(order.id);

      const res = await patch(admin, order.id, { status: to });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        code: AppErrors.INVALID_ORDER_STATUS_TRANSITION.code,
        details: { from, to, allowed },
      });
      const after = await snapshot(order.id);
      expect(after.status).toBe(dbStatus);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(after.rest).toEqual(before.rest);
      expect(await auditRowsFor(order.id)).toHaveLength(0);
    });
  });

  describe('concurrency', () => {
    it('two concurrent preparing -> ready: one 200, one 409, one audit row', async () => {
      const order = await newOrder();

      const results = await Promise.all([
        patch(admin, order.id, { status: 'ready' }),
        patch(owner, order.id, { status: 'ready' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const conflict = results.find((r) => r.status === 409);
      expect(conflict.body).toMatchObject({
        code: AppErrors.INVALID_ORDER_STATUS_TRANSITION.code,
        details: { from: 'ready', to: 'ready', allowed: ['served'] },
      });
      expect((await snapshot(order.id)).status).toBe('READY');
      expect(await auditRowsFor(order.id)).toHaveLength(1);
    });
  });

  describe('audit', () => {
    it('writes one row per change with who, which order, from and to', async () => {
      const order = await newOrder();
      await patch(admin, order.id, { status: 'ready' }).expect(200);
      await patch(owner, order.id, { status: 'served' }).expect(200);

      const rows = await auditRowsFor(order.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        action: AuditAction.CAFE_ORDER_STATUS_CHANGED,
        actorId: admin.id,
        actorRole: Role.ADMIN,
        userId: null,
        reason: `${order.orderNumber} (${order.id})`,
        details: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          from: 'preparing',
          to: 'ready',
        },
      });
      expect(rows[1]).toMatchObject({
        actorId: owner.id,
        actorRole: Role.OWNER,
        details: { orderId: order.id, orderNumber: order.orderNumber, from: 'ready', to: 'served' },
      });
    });
  });

  describe('validation and not found', () => {
    it('404 ORDER_NOT_FOUND for an unknown order', async () => {
      const res = await patch(admin, crypto.randomUUID(), { status: 'ready' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.ORDER_NOT_FOUND.code);
    });

    it('400 for a non-UUID orderId', async () => {
      const res = await patch(admin, 'not-a-uuid', { status: 'ready' });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('orderId');
    });

    it.each([
      ['paymentStatus', { status: 'ready', paymentStatus: 'paid' }],
      ['totalAed', { status: 'ready', totalAed: 0 }],
      ['items', { status: 'ready', items: [] }],
    ])('400 for an extra body key (%s), and nothing changes', async (key, body) => {
      const order = await newOrder();
      const res = await patch(admin, order.id, body);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ field: key, message: 'Unknown field' }),
      ]);
      expect((await snapshot(order.id)).status).toBe('PREPARING');
    });

    it.each([
      ['missing status', {}],
      ['uppercase status', { status: 'READY' }],
      ['cancel', { status: 'cancelled' }],
      ['paid', { status: 'paid' }],
      ['null', { status: null }],
    ])('400 for %s', async (_label, body) => {
      const order = await newOrder();
      const res = await patch(admin, order.id, body);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('status');
    });

    it('400 for a query parameter', async () => {
      const order = await newOrder();
      const res = await request(app)
        .patch(url(order.id))
        .query({ force: 'true' })
        .set('Authorization', bearerFor(admin))
        .send({ status: 'ready' });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('force');
    });

    it('405 with Allow: PATCH for other methods', async () => {
      const order = await newOrder();
      for (const method of ['get', 'put', 'post', 'delete']) {
        const res = await request(app)
          [method](url(order.id))
          .set('Authorization', bearerFor(admin));
        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('PATCH');
      }
    });
  });
});
