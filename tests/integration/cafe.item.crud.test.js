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

describe('Cafe Item Endpoints (Create, Detail, List)', () => {
  const TEST_PREFIX = 'test_item_';
  const testData = createTestData('cafe_item');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;
  let defaultCategory;

  const cleanup = async () => {
    await deleteTestCafeItems(TEST_PREFIX);
    await deleteTestCafeCategories(TEST_PREFIX);
  };

  beforeAll(async () => {
    app = createApp();
    await cleanup();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Tester' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Tester' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Tester' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Tester' });
    defaultCategory = await createTestCafeCategory(TEST_PREFIX, {
      name: `${TEST_PREFIX}Category_Base`,
    });
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await deleteTestCafeItems(TEST_PREFIX);
  });

  describe('POST /api/v1/cafe/items', () => {
    it('creates a tracked item successfully (201) with Location header', async () => {
      const payload = {
        name: `${TEST_PREFIX}Protein Bar`,
        categoryId: defaultCategory.id,
        description: 'Choc flavour',
        nutrition: { calories: 200, protein: 20 },
        priceAed: 18.5,
        imageUrl: 'https://example.com/bar.png',
        visibility: 'public',
        isTracked: true,
        stockQuantity: 25,
        unitCost: 10.0,
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(Messages.ITEM_CREATED_SUCCESS);
      expect(res.body.data.name).toBe(payload.name);
      expect(res.body.data.priceAed).toBe(18.5);
      expect(res.body.data.unitCost).toBe(10);
      expect(res.body.data.availability).toBe('available');
      expect(res.body.data.visibility).toBe('public');
      expect(res.body.data.category.id).toBe(defaultCategory.id);
      expect(res.headers.location).toBe(`/api/v1/cafe/items/${res.body.data.id}`);
    });

    it('requires stockQuantity and unitCost when isTracked=true (400)', async () => {
      const payload = {
        name: `${TEST_PREFIX}NoStockTracked`,
        categoryId: defaultCategory.id,
        priceAed: 20.0,
        isTracked: true,
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.ITEM_TRACKED_STOCK_REQUIRED.code);
      expect(res.body.message).toBe(Messages.ITEM_TRACKED_STOCK_REQUIRED);
    });

    it('auto-sets sold_out when tracked stock is 0 on creation', async () => {
      const payload = {
        name: `${TEST_PREFIX}ZeroStockItem`,
        categoryId: defaultCategory.id,
        priceAed: 15.0,
        isTracked: true,
        stockQuantity: 0,
        unitCost: 8.0,
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(ownerUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.availability).toBe('sold_out');
    });

    it('returns 400 when setting available while tracked stock is 0', async () => {
      const payload = {
        name: `${TEST_PREFIX}InvalidAvailableZero`,
        categoryId: defaultCategory.id,
        priceAed: 15.0,
        isTracked: true,
        stockQuantity: 0,
        unitCost: 8.0,
        availability: 'available',
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.ITEM_SOLD_OUT_ZERO_STOCK.code);
    });

    it('silently sets stockQuantity and unitCost to null for untracked items (isTracked=false)', async () => {
      const payload = {
        name: `${TEST_PREFIX}UntrackedCoffee`,
        categoryId: defaultCategory.id,
        priceAed: 22.0,
        isTracked: false,
        stockQuantity: 100, // should be silenced
        unitCost: 5.0, // should be silenced
        availability: 'available',
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.isTracked).toBe(false);
      expect(res.body.data.stockQuantity).toBeNull();
      expect(res.body.data.unitCost).toBeNull();
      expect(res.body.data.availability).toBe('available');
    });

    it('returns 400 CATEGORY_NOT_FOUND when categoryId does not exist', async () => {
      const fakeCatId = '00000000-0000-0000-0000-000000000000';
      const payload = {
        name: `${TEST_PREFIX}BadCatItem`,
        categoryId: fakeCatId,
        priceAed: 10.0,
        isTracked: false,
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('rejects price <= 0 with 400', async () => {
      const payload = {
        name: `${TEST_PREFIX}FreeItem`,
        categoryId: defaultCategory.id,
        priceAed: 0,
        isTracked: false,
      };

      const res = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser))
        .send(payload);

      expect(res.status).toBe(400);
    });

    it('rejects unauthorized roles (COACH, MEMBER) with 403', async () => {
      const coachRes = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(coachUser))
        .send({ name: `${TEST_PREFIX}Forbidden`, categoryId: defaultCategory.id, priceAed: 10 });
      expect(coachRes.status).toBe(403);

      const memberRes = await request(app)
        .post('/api/v1/cafe/items')
        .set('Authorization', bearerFor(memberUser))
        .send({ name: `${TEST_PREFIX}Forbidden`, categoryId: defaultCategory.id, priceAed: 10 });
      expect(memberRes.status).toBe(403);
    });
  });

  describe('GET /api/v1/cafe/items', () => {
    it('returns items list with pagination envelope and includes category', async () => {
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}ItemA`,
        categoryId: defaultCategory.id,
        priceAed: 12.0,
      });

      const res = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${defaultCategory.id}`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);

      const itemA = res.body.data.find((i) => i.name === `${TEST_PREFIX}ItemA`);
      expect(itemA).toBeDefined();
      expect(itemA.priceAed).toBe(12);
      expect(itemA.category).toBeDefined();
      expect(itemA.category.name).toBe(defaultCategory.name);
    });

    it('filters items by categoryId', async () => {
      const otherCategory = await createTestCafeCategory(TEST_PREFIX, {
        name: `${TEST_PREFIX}OtherCat`,
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}InDefaultCat`,
        categoryId: defaultCategory.id,
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}InOtherCat`,
        categoryId: otherCategory.id,
      });

      const res = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${otherCategory.id}`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      const testItems = res.body.data.filter((i) => i.name.startsWith(TEST_PREFIX));
      expect(testItems.length).toBe(1);
      expect(testItems[0].name).toBe(`${TEST_PREFIX}InOtherCat`);
    });

    it('escapes search wildcards (%) and searches name and description', async () => {
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}100% Whey Protein`,
        description: 'Top grade',
        categoryId: defaultCategory.id,
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}Regular Bar`,
        description: 'Contains 100% real cocoa',
        categoryId: defaultCategory.id,
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}Unrelated`,
        description: 'No match',
        categoryId: defaultCategory.id,
      });

      const res = await request(app)
        .get('/api/v1/cafe/items?search=100%')
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      const testItems = res.body.data.filter((i) => i.name.startsWith(TEST_PREFIX));
      expect(testItems.length).toBe(2);
    });

    it('MEMBER role sees only visibility=public, while sold_out items remain visible', async () => {
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}PublicAvailable`,
        categoryId: defaultCategory.id,
        visibility: 'PUBLIC',
        availability: 'AVAILABLE',
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}PublicSoldOut`,
        categoryId: defaultCategory.id,
        visibility: 'PUBLIC',
        availability: 'SOLD_OUT',
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}StaffOnlySecret`,
        categoryId: defaultCategory.id,
        visibility: 'STAFF_ONLY',
        availability: 'AVAILABLE',
      });

      // Member should see both public items (available AND sold_out), but NOT staff_only
      const memberRes = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${defaultCategory.id}`)
        .set('Authorization', bearerFor(memberUser));

      expect(memberRes.status).toBe(200);
      const memberItemNames = memberRes.body.data
        .filter((i) => i.name.startsWith(TEST_PREFIX))
        .map((i) => i.name);

      expect(memberItemNames).toContain(`${TEST_PREFIX}PublicAvailable`);
      expect(memberItemNames).toContain(`${TEST_PREFIX}PublicSoldOut`);
      expect(memberItemNames).not.toContain(`${TEST_PREFIX}StaffOnlySecret`);

      // Staff (ADMIN, COACH) sees all
      const adminRes = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${defaultCategory.id}`)
        .set('Authorization', bearerFor(adminUser));
      const adminItemNames = adminRes.body.data
        .filter((i) => i.name.startsWith(TEST_PREFIX))
        .map((i) => i.name);

      expect(adminItemNames).toContain(`${TEST_PREFIX}StaffOnlySecret`);
    });

    it('MEMBER role filtering: ?categoryId= and ?search= never leak staff_only items', async () => {
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}LeakedMatch Public`,
        description: 'Target query',
        categoryId: defaultCategory.id,
        visibility: 'PUBLIC',
      });
      await createTestCafeItem(TEST_PREFIX, {
        name: `${TEST_PREFIX}LeakedMatch Secret`,
        description: 'Target query',
        categoryId: defaultCategory.id,
        visibility: 'STAFF_ONLY',
      });

      // Member queries with categoryId and search
      const memberRes = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${defaultCategory.id}&search=LeakedMatch`)
        .set('Authorization', bearerFor(memberUser));

      expect(memberRes.status).toBe(200);
      const memberNames = memberRes.body.data
        .filter((i) => i.name.startsWith(TEST_PREFIX))
        .map((i) => i.name);

      expect(memberNames).toEqual([`${TEST_PREFIX}LeakedMatch Public`]);

      // Admin queries with same filters and sees both
      const adminRes = await request(app)
        .get(`/api/v1/cafe/items?categoryId=${defaultCategory.id}&search=LeakedMatch`)
        .set('Authorization', bearerFor(adminUser));

      expect(adminRes.status).toBe(200);
      const adminNames = adminRes.body.data
        .filter((i) => i.name.startsWith(TEST_PREFIX))
        .map((i) => i.name);

      expect(adminNames).toContain(`${TEST_PREFIX}LeakedMatch Public`);
      expect(adminNames).toContain(`${TEST_PREFIX}LeakedMatch Secret`);
    });
  });

  describe('GET /api/v1/cafe/items/:itemId', () => {
    it('returns item details for a valid id (200)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        name: `${TEST_PREFIX}SingleItem`,
      });

      const res = await request(app)
        .get(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(item.id);
      expect(res.body.data.name).toBe(`${TEST_PREFIX}SingleItem`);
      expect(res.body.data.category.id).toBe(defaultCategory.id);
    });

    it('returns 404 for non-existent itemId', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/cafe/items/${fakeId}`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.ITEM_NOT_FOUND.code);
    });

    it('returns 404 when a MEMBER requests a staff_only item', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        name: `${TEST_PREFIX}StaffSecret`,
        visibility: 'STAFF_ONLY',
      });

      // Member gets 404
      const memberRes = await request(app)
        .get(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(memberUser));
      expect(memberRes.status).toBe(404);

      // Staff gets 200
      const adminRes = await request(app)
        .get(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser));
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.visibility).toBe('staff_only');
    });
  });

  describe('405 Method Not Allowed handling on item routes', () => {
    it('returns 405 on disallowed methods on /items', async () => {
      const res = await request(app)
        .delete('/api/v1/cafe/items')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toContain('GET');
      expect(res.headers.allow).toContain('POST');
    });

    it('returns 405 on DELETE on /items/:itemId (items are never deleted)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });
      const res = await request(app)
        .delete(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toContain('GET');
    });
  });
});
