const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const {
  deleteTestCafeItems,
  deleteTestCafeCategories,
  createTestCafeCategory,
  createTestCafeItem,
} = require('../helpers/cafe.helper');

jest.setTimeout(60000);

// SLAPP-79/81 sub-task 5. The DB is shared and the seed suite force-reseeds, so every case reads
// a baseline summary first and asserts only the delta caused by its own prefix-scoped fixtures.
describe('GET /api/v1/cafe/inventory/summary', () => {
  const TEST_PREFIX = 'test_inv_sum_';
  const URL = '/api/v1/cafe/inventory/summary';
  const testData = createTestData('cafe_inv_sum');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let category;

  const SUMMARY_KEYS = [
    'trackedItems',
    'lowStock',
    'outOfStock',
    'stockValueAed',
    'itemsMissingCost',
    'itemsSold',
    'revenueFromItemsAed',
    'bestSeller',
    'salesDataAvailable',
  ];

  // Compare money in integer fils so float noise in the AED numbers cannot mask a wrong sum.
  const fils = (aed) => Math.round(aed * 100);

  const readSummary = async (user = adminUser) => {
    const res = await request(app).get(URL).set('Authorization', bearerFor(user));
    expect(res.status).toBe(200);
    return res.body.data;
  };

  const delta = (before, after) => ({
    trackedItems: after.trackedItems - before.trackedItems,
    lowStock: after.lowStock - before.lowStock,
    outOfStock: after.outOfStock - before.outOfStock,
    itemsMissingCost: after.itemsMissingCost - before.itemsMissingCost,
    stockValueFils: fils(after.stockValueAed) - fils(before.stockValueAed),
  });

  const tracked = (overrides) =>
    createTestCafeItem(TEST_PREFIX, { categoryId: category.id, ...overrides });
  const untracked = (label) =>
    createTestCafeItem(TEST_PREFIX, {
      categoryId: category.id,
      name: `${TEST_PREFIX}${label}_${Date.now()}`,
      isTracked: false,
      stockQuantity: null,
      unitCost: null,
    });

  const cleanup = async () => {
    await deleteTestCafeItems(TEST_PREFIX);
    await deleteTestCafeCategories(TEST_PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Summary Admin' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Summary Owner' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Summary Coach' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Summary Member' });
    category = await createTestCafeCategory(TEST_PREFIX);
  });

  afterEach(async () => {
    await deleteTestCafeItems(TEST_PREFIX);
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  describe('auth and roles', () => {
    it('returns 401 without a bearer token', async () => {
      const res = await request(app).get(URL);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it.each([
      ['COACH', () => coachUser],
      ['MEMBER', () => memberUser],
    ])('returns 403 for %s', async (_role, getUser) => {
      const res = await request(app).get(URL).set('Authorization', bearerFor(getUser()));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.FORBIDDEN.code);
    });
  });

  describe('response', () => {
    it('returns exactly the summary fields with the documented types (OWNER)', async () => {
      const res = await request(app).get(URL).set('Authorization', bearerFor(ownerUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(Object.keys(data).sort()).toEqual([...SUMMARY_KEYS].sort());
      for (const key of ['trackedItems', 'lowStock', 'outOfStock', 'itemsMissingCost']) {
        expect(Number.isInteger(data[key])).toBe(true);
        expect(data[key]).toBeGreaterThanOrEqual(0);
      }
      expect(typeof data.stockValueAed).toBe('number');
      expect(data.stockValueAed).toBeGreaterThanOrEqual(0);
      expect(data.outOfStock).toBeLessThanOrEqual(data.lowStock);
      expect(data.lowStock).toBeLessThanOrEqual(data.trackedItems);
      expect(data.itemsMissingCost).toBeLessThanOrEqual(data.trackedItems);
    });

    it('returns null sales fields and salesDataAvailable false', async () => {
      const data = await readSummary();

      expect(data.itemsSold).toBeNull();
      expect(data.revenueFromItemsAed).toBeNull();
      expect(data.bestSeller).toBeNull();
      expect(data.salesDataAvailable).toBe(false);
    });
  });

  describe('counts and value (deltas against a baseline)', () => {
    it('changes every card by the expected delta, staff_only included and untracked ignored', async () => {
      const before = await readSummary();

      await tracked({ stockQuantity: 3, unitCost: 0.1 }); // low, value 0.30
      await tracked({ stockQuantity: 0, unitCost: 2.5, availability: 'SOLD_OUT' }); // low + out, value 0
      await tracked({ stockQuantity: 20, unitCost: 0 }); // missing cost, no value
      await tracked({ stockQuantity: 15, unitCost: 1.15, visibility: 'STAFF_ONLY' }); // in stock, value 17.25
      await untracked('coffee');
      await untracked('shake');
      await untracked('cooler');

      const after = await readSummary();

      expect(delta(before, after)).toEqual({
        trackedItems: 4,
        lowStock: 2,
        outOfStock: 1,
        itemsMissingCost: 1,
        stockValueFils: 1755,
      });
    });

    it('sums stock value exactly with decimal costs (0.10 x 3 + 0.20 x 1 + 0.01 x 7)', async () => {
      const before = await readSummary();

      await tracked({ stockQuantity: 3, unitCost: 0.1 });
      await tracked({ stockQuantity: 1, unitCost: 0.2 });
      await tracked({ stockQuantity: 7, unitCost: 0.01 });

      const after = await readSummary();

      expect(delta(before, after).stockValueFils).toBe(57);
      // The response itself stays a 2-dp AED number (no float tail like 0.30000000000000004).
      expect(fils(after.stockValueAed) / 100).toBe(after.stockValueAed);
    });

    it('excludes zero-cost items from the value and counts them as missing cost', async () => {
      const before = await readSummary();

      await tracked({ stockQuantity: 50, unitCost: 0 });
      await tracked({ stockQuantity: 0, unitCost: 0 });
      await tracked({ stockQuantity: 0, unitCost: 4 }); // positive cost at zero stock: not missing

      const after = await readSummary();

      expect(delta(before, after)).toEqual({
        trackedItems: 3,
        lowStock: 2,
        outOfStock: 2,
        itemsMissingCost: 2,
        stockValueFils: 0,
      });
    });

    it('does not count untracked items at all', async () => {
      const before = await readSummary();

      await untracked('coffee');
      await untracked('shake');
      await untracked('cooler');

      const after = await readSummary();

      expect(delta(before, after)).toEqual({
        trackedItems: 0,
        lowStock: 0,
        outOfStock: 0,
        itemsMissingCost: 0,
        stockValueFils: 0,
      });
    });

    it('refreshes after a stock PATCH', async () => {
      const item = await tracked({ stockQuantity: 20, unitCost: 2 });
      const before = await readSummary();

      const toZero = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/stock`)
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 0 });
      expect(toZero.status).toBe(200);

      const afterZero = await readSummary();
      expect(delta(before, afterZero)).toEqual({
        trackedItems: 0,
        lowStock: 1,
        outOfStock: 1,
        itemsMissingCost: 0,
        stockValueFils: -4000,
      });

      const toFive = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/stock`)
        .set('Authorization', bearerFor(adminUser))
        .send({ quantity: 5 });
      expect(toFive.status).toBe(200);

      const afterFive = await readSummary();
      expect(delta(before, afterFive)).toEqual({
        trackedItems: 0,
        lowStock: 1,
        outOfStock: 0,
        itemsMissingCost: 0,
        stockValueFils: -3000,
      });
    });
  });

  describe('405 Method Not Allowed', () => {
    it.each(['post', 'put', 'patch', 'delete'])(
      'returns 405 with Allow: GET on %s',
      async (method) => {
        const res = await request(app)[method](URL).set('Authorization', bearerFor(adminUser));

        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('GET');
        expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      },
    );
  });
});
