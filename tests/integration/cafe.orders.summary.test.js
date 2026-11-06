const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestCafeOrder, deleteTestCafeOrders } = require('../helpers/cafeOrder.helper');
const { getTodayInTimezone } = require('../../src/services/schedule.service');

jest.setTimeout(60000);

// Admin cases use dates in 2002 that no other suite writes to, so shared-DB rows cannot leak in.
describe('GET /api/v1/cafe/orders/summary', () => {
  const PREFIX = 'TSUM-';
  const URL = '/api/v1/cafe/orders/summary';
  const DAY = '2002-07-15';
  const AT_DAY = new Date('2002-07-15T08:00:00Z');
  const testData = createTestData('cafe_ord_sum');
  let app;
  let admin;
  let owner;
  let coachA;
  let coachB;
  let member;

  const get = (user, query = {}) =>
    request(app).get(URL).query(query).set('Authorization', bearerFor(user));

  const order = (user, items, extra = {}) =>
    createTestCafeOrder(PREFIX, { createdById: user.id, items, createdAt: AT_DAY, ...extra });
  const line = (itemName, quantity, unitPriceAed = '10.00') => ({
    itemName,
    quantity,
    unitPriceAed,
  });

  beforeAll(async () => {
    app = createApp();
    await deleteTestCafeOrders(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
    owner = await testData.createUser({ role: Role.OWNER });
    coachA = await testData.createUser({ role: Role.COACH });
    coachB = await testData.createUser({ role: Role.COACH });
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

  it('returns 401 without a token and 403 for MEMBER', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await get(member)).status).toBe(403);
  });

  it('returns exactly the summary fields, with no revenue or total', async () => {
    const res = await get(owner, { from: DAY, to: DAY });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['range', 'orderCount', 'preparingCount', 'topSeller', 'itemSalesHistory'].sort(),
    );
    expect(JSON.stringify(res.body.data)).not.toMatch(/revenue|total|paid/i);
  });

  it('returns zeros and a null top seller for an empty range', async () => {
    const res = await get(admin, { from: DAY, to: DAY });
    expect(res.body.data).toEqual({
      range: { from: DAY, to: DAY, timezone: env.FACILITY_TIMEZONE },
      orderCount: 0,
      preparingCount: 0,
      topSeller: null,
      itemSalesHistory: [],
    });
  });

  it('counts orders, counts only PREPARING as preparing, and ranks items by quantity', async () => {
    await order(coachA, [line('Latte', 2), line('Croissant', 1)], { status: 'PREPARING' });
    await order(coachA, [line('Latte', 1)], { status: 'READY' });
    await order(coachB, [line('Croissant', 1), line('Smoothie', 5, '25.00')], { status: 'SERVED' });
    await order(coachB, [line('Latte', 1)], { status: 'PREPARING' });
    // Outside the range: must not count.
    await order(coachA, [line('Smoothie', 50)], {
      createdAt: new Date('2002-07-16T08:00:00Z'),
    });

    const res = await get(admin, { from: DAY, to: DAY });
    expect(res.body.data).toMatchObject({
      orderCount: 4,
      preparingCount: 2,
      topSeller: { itemName: 'Smoothie', quantity: 5 },
      itemSalesHistory: [
        { itemName: 'Smoothie', quantity: 5 },
        { itemName: 'Latte', quantity: 4 },
        { itemName: 'Croissant', quantity: 2 },
      ],
    });
  });

  it('ranks by quantity, not by price or number of orders', async () => {
    await order(coachA, [line('Water', 6, '2.00')]);
    await order(coachA, [line('Steak Bowl', 1, '90.00')]);
    await order(coachA, [line('Steak Bowl', 1, '90.00')]);

    const res = await get(coachA, { from: DAY, to: DAY });
    expect(res.body.data.topSeller).toEqual({ itemName: 'Water', quantity: 6 });
  });

  it('breaks quantity ties alphabetically by item name', async () => {
    await order(coachA, [line('Zaatar Wrap', 3), line('Avocado Toast', 3)]);
    const res = await get(coachA, { from: DAY, to: DAY });
    expect(res.body.data.topSeller.itemName).toBe('Avocado Toast');
    expect(res.body.data.itemSalesHistory.map((r) => r.itemName)).toEqual([
      'Avocado Toast',
      'Zaatar Wrap',
    ]);
  });

  it('applies the list visibility rule: staff see only their own orders', async () => {
    await order(coachA, [line('Latte', 2)], { status: 'PREPARING' });
    await order(coachB, [line('Mocha', 9)], { status: 'PREPARING' });

    const a = await get(coachA, { from: DAY, to: DAY });
    expect(a.body.data).toMatchObject({
      orderCount: 1,
      preparingCount: 1,
      topSeller: { itemName: 'Latte', quantity: 2 },
      itemSalesHistory: [{ itemName: 'Latte', quantity: 2 }],
    });

    const all = await get(admin, { from: DAY, to: DAY });
    expect(all.body.data.orderCount).toBe(2);
    expect(all.body.data.topSeller).toEqual({ itemName: 'Mocha', quantity: 9 });
  });

  it('defaults the range to today in facility time', async () => {
    const today = getTodayInTimezone(env.FACILITY_TIMEZONE);
    await createTestCafeOrder(PREFIX, { createdById: coachA.id, items: [line('Today Tea', 1)] });
    await order(coachA, [line('Old Tea', 1)]);

    const res = await get(coachA);
    expect(res.body.data.range).toEqual({
      from: today,
      to: today,
      timezone: env.FACILITY_TIMEZONE,
    });
    expect(res.body.data.orderCount).toBe(1);
    expect(res.body.data.itemSalesHistory).toEqual([{ itemName: 'Today Tea', quantity: 1 }]);
  });

  it('spans multiple days when from and to differ', async () => {
    await order(coachA, [line('Latte', 1)]);
    await order(coachA, [line('Latte', 1)], { createdAt: new Date('2002-07-17T08:00:00Z') });
    const res = await get(coachA, { from: '2002-07-15', to: '2002-07-17' });
    expect(res.body.data.orderCount).toBe(2);
    expect(res.body.data.topSeller).toEqual({ itemName: 'Latte', quantity: 2 });
  });

  it.each([
    [{ from: '2002-07-16', to: '2002-07-15' }],
    [{ from: 'yesterday' }],
    [{ status: 'preparing' }],
    [{ userId: 'x' }],
  ])('rejects %o with 422', async (query) => {
    expect((await get(admin, query)).status).toBe(422);
  });

  it('is not shadowed by /orders/:orderId', async () => {
    const res = await get(admin, { from: DAY, to: DAY });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('orderCount');
  });
});
