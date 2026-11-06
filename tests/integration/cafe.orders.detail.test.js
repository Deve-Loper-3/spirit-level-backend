const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestCafeOrder, deleteTestCafeOrders } = require('../helpers/cafeOrder.helper');

jest.setTimeout(60000);

describe('GET /api/v1/cafe/orders/:orderId', () => {
  const PREFIX = 'TDTL-';
  const url = (id) => `/api/v1/cafe/orders/${id}`;
  const testData = createTestData('cafe_ord_detail');
  let app;
  let admin;
  let owner;
  let coachA;
  let coachB;
  let member;
  let orderA;

  const get = (user, id) => request(app).get(url(id)).set('Authorization', bearerFor(user));

  beforeAll(async () => {
    app = createApp();
    await deleteTestCafeOrders(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coachA = await testData.createUser({ role: Role.COACH, fullName: 'Detail Coach A' });
    coachB = await testData.createUser({ role: Role.COACH });
    member = await testData.createUser({ role: Role.MEMBER });
    orderA = await createTestCafeOrder(PREFIX, {
      createdById: coachA.id,
      customerName: 'Noor',
      status: 'READY',
      items: [
        { itemName: 'Cappuccino', unitPriceAed: '0.10', quantity: 3 },
        { itemName: 'Banana Bread', unitPriceAed: '14.50', quantity: 2 },
      ],
    });
  });

  afterAll(async () => {
    await deleteTestCafeOrders(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get(url(orderA.id))).status).toBe(401);
  });

  it('returns 403 for MEMBER', async () => {
    const res = await get(member, orderA.id);
    expect(res.status).toBe(403);
  });

  it('returns the creator their order with snapshot line items', async () => {
    const res = await get(coachA, orderA.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: orderA.id,
      orderNumber: orderA.orderNumber,
      status: 'ready',
      customerName: 'Noor',
      totalAed: 29.3,
      paymentStatus: 'not_tracked',
      createdBy: { id: coachA.id, fullName: 'Detail Coach A' },
      itemCount: 2,
    });
    expect(res.body.data.items).toEqual([
      {
        id: expect.any(String),
        itemName: 'Banana Bread',
        unitPriceAed: 14.5,
        quantity: 2,
        lineTotalAed: 29,
      },
      {
        id: expect.any(String),
        itemName: 'Cappuccino',
        unitPriceAed: 0.1,
        quantity: 3,
        lineTotalAed: 0.3,
      },
    ]);
  });

  it.each([
    ['ADMIN', () => admin],
    ['OWNER', () => owner],
  ])('%s can read any order', async (_role, getUser) => {
    const res = await get(getUser(), orderA.id);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderA.id);
  });

  it('returns 404 (not 403) when a staff member asks for another user’s order', async () => {
    const res = await get(coachB, orderA.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(AppErrors.ORDER_NOT_FOUND.code);
  });

  it('returns the same 404 for an order that does not exist', async () => {
    const res = await get(admin, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(AppErrors.ORDER_NOT_FOUND.code);
  });

  it.each(['userId', 'createdById', 'include'])(
    'rejects the unknown `%s` query parameter with 422',
    async (param) => {
      const res = await request(app)
        .get(url(orderA.id))
        .query({ [param]: coachB.id })
        .set('Authorization', bearerFor(coachB));
      expect(res.status).toBe(422);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ field: param, message: 'Unknown query parameter' }),
      ]);
    },
  );

  it('returns 422 for a non-UUID id', async () => {
    const res = await get(admin, 'not-a-uuid');
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('orderId');
  });

  it('returns 405 for PATCH and DELETE (status changes are phase 2)', async () => {
    const patch = await request(app)
      .patch(url(orderA.id))
      .set('Authorization', bearerFor(admin))
      .send({ status: 'served' });
    const del = await request(app).delete(url(orderA.id)).set('Authorization', bearerFor(admin));
    expect(patch.status).toBe(405);
    expect(del.status).toBe(405);
  });
});
