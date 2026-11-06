const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { createTestCafeOrder, deleteTestCafeOrders } = require('../helpers/cafeOrder.helper');
const {
  createTestCafeCategory,
  createTestCafeItem,
  deleteTestCafeItems,
  deleteTestCafeCategories,
} = require('../helpers/cafe.helper');

jest.setTimeout(60000);

// Historical order item names and prices must never change.
describe('cafe order schema: snapshots and constraints', () => {
  const PREFIX = 'TSNP-';
  const CAT_PREFIX = 'test_ord_snap_';
  const testData = createTestData('cafe_ord_snap');
  let app;
  let admin;
  let coach;

  beforeAll(async () => {
    app = createApp();
    await deleteTestCafeOrders(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
    coach = await testData.createUser({ role: Role.COACH });
  });

  afterAll(async () => {
    await deleteTestCafeOrders(PREFIX);
    await deleteTestCafeItems(CAT_PREFIX);
    await deleteTestCafeCategories(CAT_PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('keeps the order item name and price after the catalogue item is renamed, repriced and deleted', async () => {
    const category = await createTestCafeCategory(CAT_PREFIX);
    const item = await createTestCafeItem(CAT_PREFIX, {
      categoryId: category.id,
      name: `${CAT_PREFIX}Pistachio Latte`,
      priceAed: '21.00',
    });
    const order = await createTestCafeOrder(PREFIX, {
      createdById: coach.id,
      items: [{ itemName: item.name, unitPriceAed: '21.00', quantity: 2 }],
    });

    await request(app)
      .patch(`/api/v1/cafe/items/${item.id}`)
      .set('Authorization', bearerFor(admin))
      .send({ name: `${CAT_PREFIX}Renamed`, priceAed: 99 })
      .expect(200);
    await prisma.cafeItem.delete({ where: { id: item.id } });

    const res = await request(app)
      .get(`/api/v1/cafe/orders/${order.id}`)
      .set('Authorization', bearerFor(admin));
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ itemName: item.name, unitPriceAed: 21, quantity: 2 }),
    ]);
    expect(res.body.data.totalAed).toBe(42);
  });

  it.each([
    ['itemName', { itemName: 'Tampered' }],
    ['unitPriceAed', { unitPriceAed: '0.01' }],
    ['quantity', { quantity: 99 }],
  ])('the DB rejects an update to %s', async (_col, data) => {
    const order = await createTestCafeOrder(PREFIX, { createdById: coach.id });
    const [line] = order.items;

    await expect(prisma.cafeOrderItem.update({ where: { id: line.id }, data })).rejects.toThrow(
      /immutable/,
    );
    const after = await prisma.cafeOrderItem.findUnique({ where: { id: line.id } });
    expect(after).toEqual(line);
  });

  it('defaults status to PREPARING and payment status to NOT_TRACKED', async () => {
    const order = await createTestCafeOrder(PREFIX, { createdById: coach.id });
    expect(order.status).toBe('PREPARING');
    expect(order.paymentStatus).toBe('NOT_TRACKED');
  });

  it('cannot store any payment status other than NOT_TRACKED', async () => {
    const order = await createTestCafeOrder(PREFIX, { createdById: coach.id });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "cafe_orders" SET "paymentStatus" = 'PAID' WHERE "id" = $1`,
        order.id,
      ),
    ).rejects.toThrow();
  });

  it('requires a unique order number', async () => {
    const first = await createTestCafeOrder(PREFIX, { createdById: coach.id });
    await expect(
      createTestCafeOrder(PREFIX, { createdById: coach.id, orderNumber: first.orderNumber }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('requires an existing creator', async () => {
    await expect(
      createTestCafeOrder(PREFIX, { createdById: crypto.randomUUID() }),
    ).rejects.toThrow();
  });

  it.each([
    ['zero quantity', { items: [{ itemName: 'X', unitPriceAed: '1.00', quantity: 0 }] }],
    ['negative price', { items: [{ itemName: 'X', unitPriceAed: '-1.00', quantity: 1 }] }],
    ['blank item name', { items: [{ itemName: '  ', unitPriceAed: '1.00', quantity: 1 }] }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(
      createTestCafeOrder(PREFIX, { createdById: coach.id, ...overrides }),
    ).rejects.toThrow();
  });

  it('blocks deleting a user who created orders, and cleanup helpers remove orders first', async () => {
    const scratch = createTestData('cafe_ord_snap_user');
    const creator = await scratch.createUser({ role: Role.COACH });
    const order = await createTestCafeOrder(PREFIX, { createdById: creator.id });

    await expect(prisma.user.delete({ where: { id: creator.id } })).rejects.toThrow();

    await scratch.cleanup();
    expect(await prisma.user.findUnique({ where: { id: creator.id } })).toBeNull();
    expect(await prisma.cafeOrder.findUnique({ where: { id: order.id } })).toBeNull();
    expect(await prisma.cafeOrderItem.count({ where: { orderId: order.id } })).toBe(0);
  });
});
