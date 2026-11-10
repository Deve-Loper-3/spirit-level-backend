const crypto = require('crypto');
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

// SLAPP-79/81 sub-task 4. The DB is shared and the seed suite force-reseeds, so every assertion
// is scoped to this suite's own categories or its run-unique search term; no global totals.
describe('GET /api/v1/cafe/inventory', () => {
  const TEST_PREFIX = 'test_inv_list_';
  // Hex only: search terms stay free of LIKE wildcards (_ and %).
  const RUN = crypto.randomBytes(4).toString('hex');
  const URL = '/api/v1/cafe/inventory';
  const testData = createTestData('cafe_inv_list');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let categoryA;
  let categoryB;
  const items = {};

  const itemName = (label) => `${TEST_PREFIX}${RUN}${label}`;

  const cleanup = async () => {
    await deleteTestCafeItems(TEST_PREFIX);
    await deleteTestCafeCategories(TEST_PREFIX);
  };

  const getInventory = (query, user = adminUser) =>
    request(app).get(URL).query(query).set('Authorization', bearerFor(user));

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Inventory Admin' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Inventory Owner' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Inventory Coach' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Inventory Member' });
    categoryA = await createTestCafeCategory(TEST_PREFIX);
    categoryB = await createTestCafeCategory(TEST_PREFIX);

    const tracked = (label, overrides) =>
      createTestCafeItem(TEST_PREFIX, {
        categoryId: categoryA.id,
        name: itemName(label),
        ...overrides,
      });
    const untracked = (label) =>
      createTestCafeItem(TEST_PREFIX, {
        categoryId: categoryA.id,
        name: itemName(label),
        isTracked: false,
        stockQuantity: null,
        unitCost: null,
      });

    // Labels sort a..e by name; quantities cover every status boundary.
    items.q0 = await tracked('qa0', { stockQuantity: 0, availability: 'SOLD_OUT', unitCost: 3.25 });
    items.q1 = await tracked('qb1', { stockQuantity: 1 });
    items.q14 = await tracked('qc14', { stockQuantity: 14 });
    items.q15 = await tracked('qd15', { stockQuantity: 15, visibility: 'STAFF_ONLY' });
    items.q16 = await tracked('qe16', { stockQuantity: 16, unitCost: 0 });
    items.coffee = await untracked('coffee');
    items.shake = await untracked('shake');
    items.cooler = await untracked('cooler');
    items.otherCategory = await createTestCafeItem(TEST_PREFIX, {
      categoryId: categoryB.id,
      name: itemName('qf20'),
      stockQuantity: 20,
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const categoryAOrder = () =>
    [items.q0, items.q1, items.q14, items.q15, items.q16].map((i) => i.id);

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
      const res = await getInventory({ categoryId: categoryA.id }, getUser());

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(AppErrors.FORBIDDEN.code);
    });

    it('allows OWNER', async () => {
      const res = await getInventory({ categoryId: categoryA.id }, ownerUser);

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(5);
    });
  });

  describe('listing', () => {
    it('returns tracked items only, name ascending, in the pagination envelope', async () => {
      const res = await getInventory({ categoryId: categoryA.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((i) => i.id)).toEqual(categoryAOrder());
      const ids = res.body.data.map((i) => i.id);
      for (const untracked of [items.coffee, items.shake, items.cooler]) {
        expect(ids).not.toContain(untracked.id);
      }
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 5, totalPages: 1 });
    });

    it('returns the inventory view for each item', async () => {
      const res = await getInventory({ categoryId: categoryA.id });
      const q0 = res.body.data.find((i) => i.id === items.q0.id);

      expect(q0).toEqual({
        id: items.q0.id,
        name: items.q0.name,
        categoryId: categoryA.id,
        category: { id: categoryA.id, name: categoryA.name },
        quantity: 0,
        unitCost: 3.25,
        stockStatus: 'OUT_OF_STOCK',
      });
    });

    it.each([
      ['q0', 0, 'OUT_OF_STOCK'],
      ['q1', 1, 'LOW_STOCK'],
      ['q14', 14, 'LOW_STOCK'],
      ['q15', 15, 'IN_STOCK'],
      ['q16', 16, 'IN_STOCK'],
    ])('item %s with quantity %i has stockStatus %s', async (key, quantity, expected) => {
      const res = await getInventory({ categoryId: categoryA.id });
      const row = res.body.data.find((i) => i.id === items[key].id);

      expect(row.quantity).toBe(quantity);
      expect(row.stockStatus).toBe(expected);
    });

    it('includes staff_only tracked items', async () => {
      const res = await getInventory({ categoryId: categoryA.id });

      expect(res.body.data.map((i) => i.id)).toContain(items.q15.id);
    });

    it('returns a zero unitCost as null without changing the catalogue response', async () => {
      const res = await getInventory({ categoryId: categoryA.id });
      const row = res.body.data.find((i) => i.id === items.q16.id);
      expect(row.unitCost).toBeNull();
      expect(res.body.data.find((i) => i.id === items.q1.id).unitCost).toBe(15);

      const catalogue = await request(app)
        .get(`/api/v1/cafe/items/${items.q16.id}`)
        .set('Authorization', bearerFor(adminUser));
      expect(catalogue.status).toBe(200);
      expect(catalogue.body.data.unitCost).toBe(0);
    });
  });

  describe('filters', () => {
    it('filters by category', async () => {
      const res = await getInventory({ categoryId: categoryB.id });

      expect(res.status).toBe(200);
      expect(res.body.data.map((i) => i.id)).toEqual([items.otherCategory.id]);
      expect(res.body.pagination.total).toBe(1);
    });

    it.each([
      ['OUT_OF_STOCK', ['q0']],
      ['LOW_STOCK', ['q1', 'q14']],
      ['IN_STOCK', ['q15', 'q16']],
    ])('filters by status %s', async (status, keys) => {
      const res = await getInventory({ categoryId: categoryA.id, status });

      expect(res.status).toBe(200);
      expect(res.body.data.map((i) => i.id)).toEqual(keys.map((k) => items[k].id));
      expect(res.body.data.every((i) => i.stockStatus === status)).toBe(true);
      expect(res.body.pagination.total).toBe(keys.length);
    });

    it('searches by name (case-insensitive) across categories, tracked only', async () => {
      const all = await getInventory({ search: RUN.toUpperCase() });
      expect(all.status).toBe(200);
      expect(all.body.data.map((i) => i.id)).toEqual([...categoryAOrder(), items.otherCategory.id]);
      expect(all.body.pagination.total).toBe(6);

      const one = await getInventory({ search: `${RUN}qc14` });
      expect(one.body.data.map((i) => i.id)).toEqual([items.q14.id]);
      expect(one.body.pagination.total).toBe(1);
    });

    it('combines search, category and status filters', async () => {
      const res = await getInventory({ search: RUN, categoryId: categoryA.id, status: 'IN_STOCK' });

      expect(res.body.data.map((i) => i.id)).toEqual([items.q15.id, items.q16.id]);
      expect(res.body.pagination.total).toBe(2);
    });
  });

  describe('pagination', () => {
    it('pages through results with page, limit, total and totalPages', async () => {
      const order = categoryAOrder();

      const page1 = await getInventory({ categoryId: categoryA.id, limit: 2, page: 1 });
      expect(page1.body.data.map((i) => i.id)).toEqual(order.slice(0, 2));
      expect(page1.body.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });

      const page3 = await getInventory({ categoryId: categoryA.id, limit: 2, page: 3 });
      expect(page3.body.data.map((i) => i.id)).toEqual(order.slice(4));
      expect(page3.body.pagination).toEqual({ page: 3, limit: 2, total: 5, totalPages: 3 });
    });

    it('returns an empty page past the end with correct totals', async () => {
      const res = await getInventory({ categoryId: categoryA.id, limit: 2, page: 4 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ page: 4, limit: 2, total: 5, totalPages: 3 });
    });

    it('applies the status filter before pagination so totals stay accurate', async () => {
      const page2 = await getInventory({
        categoryId: categoryA.id,
        status: 'LOW_STOCK',
        limit: 1,
        page: 2,
      });

      expect(page2.body.data.map((i) => i.id)).toEqual([items.q14.id]);
      expect(page2.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    });
  });

  describe('validation (400)', () => {
    it.each([
      ['page 0', { page: 0 }],
      ['non-numeric page', { page: 'abc' }],
      ['limit above 100', { limit: 101 }],
      ['non-UUID categoryId', { categoryId: 'not-a-uuid' }],
      ['lowercase status', { status: 'low_stock' }],
    ])('rejects %s', async (_label, query) => {
      const res = await getInventory(query);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.length).toBeGreaterThan(0);
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
