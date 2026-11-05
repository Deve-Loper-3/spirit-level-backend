const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestCafeItems,
  deleteTestCafeCategories,
  createTestCafeCategory,
  createTestCafeItem,
} = require('../helpers/cafe.helper');

jest.setTimeout(40000);

// SLAPP-79/81 sub-task 3. Fixtures are prefix-scoped; no assertion depends on global totals.
describe('PATCH /api/v1/cafe/items/:itemId/stock', () => {
  const TEST_PREFIX = 'test_inv_stock_';
  const testData = createTestData('cafe_inv_stock');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let category;

  const stockUrl = (itemId) => `/api/v1/cafe/items/${itemId}/stock`;
  const createTracked = (overrides = {}) =>
    createTestCafeItem(TEST_PREFIX, { categoryId: category.id, ...overrides });
  const readRow = (id) => prisma.cafeItem.findUnique({ where: { id } });

  const cleanup = async () => {
    await deleteTestCafeItems(TEST_PREFIX);
    await deleteTestCafeCategories(TEST_PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Stock Admin' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Stock Owner' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Stock Coach' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Stock Member' });
    category = await createTestCafeCategory(TEST_PREFIX);
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await deleteTestCafeItems(TEST_PREFIX);
  });

  describe('auth and roles', () => {
    it('returns 401 without a bearer token', async () => {
      const item = await createTracked();

      const res = await request(app).patch(stockUrl(item.id)).send({ quantity: 5 });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect((await readRow(item.id)).stockQuantity).toBe(10);
    });

    it.each([
      ['COACH', () => coachUser],
      ['MEMBER', () => memberUser],
    ])('returns 403 for %s and leaves stock unchanged', async (_role, getUser) => {
      const item = await createTracked();

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(getUser()))
        .send({ quantity: 5 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.FORBIDDEN.code);
      expect((await readRow(item.id)).stockQuantity).toBe(10);
    });
  });

  describe('validation (422)', () => {
    it.each([
      ['missing quantity', {}],
      ['decimal quantity', { quantity: 2.5 }],
      ['string quantity', { quantity: '5' }],
      ['negative quantity', { quantity: -1 }],
    ])('rejects %s', async (_label, body) => {
      const item = await createTracked();

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(adminUser))
        .send(body);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'quantity' })]),
      );
      expect((await readRow(item.id)).stockQuantity).toBe(10);
    });

    it('rejects a non-UUID item id', async () => {
      const res = await request(app)
        .patch(stockUrl('not-a-uuid'))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 5 });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('item lookup errors', () => {
    it('returns 404 ITEM_NOT_FOUND for an unknown item', async () => {
      const res = await request(app)
        .patch(stockUrl(crypto.randomUUID()))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 5 });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.ITEM_NOT_FOUND.code);
    });

    it.each(['Coffee', 'Shake', 'Cooler'])(
      'returns 409 ITEM_NOT_TRACKED for an untracked %s and writes nothing',
      async (kind) => {
        const item = await createTestCafeItem(TEST_PREFIX, {
          categoryId: category.id,
          name: `${TEST_PREFIX}${kind}_${crypto.randomUUID()}`,
          isTracked: false,
          stockQuantity: null,
          unitCost: null,
        });

        const res = await request(app)
          .patch(stockUrl(item.id))
          .set('Authorization', bearerFor(ownerUser))
          .send({ quantity: 5 });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe(AppErrors.ITEM_NOT_TRACKED.code);
        expect(res.body.message).toBe(Messages.ITEM_NOT_TRACKED);

        const row = await readRow(item.id);
        expect(row.stockQuantity).toBeNull();
        expect(row.availability).toBe('AVAILABLE');
      },
    );
  });

  describe('stock writes', () => {
    it('replaces the quantity directly (no increment) and returns the stock view', async () => {
      const item = await createTracked({ stockQuantity: 10, unitCost: 4.5 });

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(ownerUser))
        .send({ quantity: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(Messages.ITEM_STOCK_UPDATED_SUCCESS);
      expect(res.body.data).toEqual({
        id: item.id,
        name: item.name,
        categoryId: category.id,
        category: { id: category.id, name: category.name },
        quantity: 3,
        unitCost: 4.5,
        stockStatus: 'LOW_STOCK',
        availability: 'available',
        updatedAt: expect.any(String),
      });
      expect((await readRow(item.id)).stockQuantity).toBe(3);
    });

    it('maps a zero unitCost to null in the response', async () => {
      const item = await createTracked({ unitCost: 0 });

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data.unitCost).toBeNull();
    });

    it('sets sold_out in the same write when quantity becomes 0', async () => {
      const item = await createTracked({ stockQuantity: 8, availability: 'AVAILABLE' });

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.quantity).toBe(0);
      expect(res.body.data.availability).toBe('sold_out');
      expect(res.body.data.stockStatus).toBe('OUT_OF_STOCK');

      const row = await readRow(item.id);
      expect(row.stockQuantity).toBe(0);
      expect(row.availability).toBe('SOLD_OUT');
    });

    it('keeps sold_out on restock (no automatic available)', async () => {
      const item = await createTracked({ stockQuantity: 0, availability: 'SOLD_OUT' });

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(ownerUser))
        .send({ quantity: 25 });

      expect(res.status).toBe(200);
      expect(res.body.data.quantity).toBe(25);
      expect(res.body.data.stockStatus).toBe('IN_STOCK');
      expect(res.body.data.availability).toBe('sold_out');
      expect((await readRow(item.id)).availability).toBe('SOLD_OUT');
    });

    it.each([
      [0, 'OUT_OF_STOCK'],
      [1, 'LOW_STOCK'],
      [14, 'LOW_STOCK'],
      [15, 'IN_STOCK'],
      [16, 'IN_STOCK'],
    ])('quantity %i returns stockStatus %s', async (quantity, expected) => {
      const item = await createTracked({ stockQuantity: 50 });

      const res = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity });

      expect(res.status).toBe(200);
      expect(res.body.data.quantity).toBe(quantity);
      expect(res.body.data.stockStatus).toBe(expected);
    });

    it('persists the new quantity on re-read through the catalogue detail endpoint', async () => {
      const item = await createTracked({ stockQuantity: 10 });

      const patchRes = await request(app)
        .patch(stockUrl(item.id))
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 42 });
      expect(patchRes.status).toBe(200);

      const getRes = await request(app)
        .get(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser));

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.stockQuantity).toBe(42);
      expect(getRes.body.data.availability).toBe('available');
      expect((await readRow(item.id)).stockQuantity).toBe(42);
    });
  });

  describe('405 Method Not Allowed', () => {
    it.each(['get', 'put', 'post', 'delete'])(
      'returns 405 with Allow: PATCH on %s',
      async (method) => {
        const res = await request(app)
          [method](stockUrl(crypto.randomUUID()))
          .set('Authorization', bearerFor(adminUser));

        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('PATCH');
        expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      },
    );
  });
});
