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

describe('Cafe Item PATCH Endpoints (Update, Availability, Visibility)', () => {
  const TEST_PREFIX = 'test_patch_';
  const testData = createTestData('cafe_patch');
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

  describe('PATCH /api/v1/cafe/items/:itemId', () => {
    it('updates standard item fields successfully (200)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        name: `${TEST_PREFIX}OldItemName`,
        priceAed: 20.0,
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({
          name: `${TEST_PREFIX}UpdatedItemName`,
          description: 'New Description',
          priceAed: 25.0,
          imageUrl: 'https://example.com/new.png',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(Messages.ITEM_UPDATED_SUCCESS);
      expect(res.body.data.name).toBe(`${TEST_PREFIX}UpdatedItemName`);
      expect(res.body.data.description).toBe('New Description');
      expect(res.body.data.priceAed).toBe(25);
      expect(res.body.data.imageUrl).toBe('https://example.com/new.png');
    });

    it('rejects availability or visibility in core PATCH (422)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const resAvail = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ availability: 'sold_out' });
      expect(resAvail.status).toBe(422);
      expect(resAvail.body.errors[0].message).toBe(Messages.ITEM_FIELD_NOT_EDITABLE_HERE);

      const resVis = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ visibility: 'staff_only' });
      expect(resVis.status).toBe(422);
      expect(resVis.body.errors[0].message).toBe(Messages.ITEM_FIELD_NOT_EDITABLE_HERE);
    });

    it('auto-sets sold_out when tracked stock becomes 0', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: true,
        stockQuantity: 10,
        availability: 'AVAILABLE',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(ownerUser))
        .send({ stockQuantity: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.stockQuantity).toBe(0);
      expect(res.body.data.availability).toBe('sold_out');
    });

    it('does NOT auto-set available on restock (stays sold_out)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: true,
        stockQuantity: 0,
        availability: 'SOLD_OUT',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ stockQuantity: 50 });

      expect(res.status).toBe(200);
      expect(res.body.data.stockQuantity).toBe(50);
      expect(res.body.data.availability).toBe('sold_out');
    });

    it('returns 400 when switching isTracked from false to true without stockQuantity and unitCost', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: false,
        stockQuantity: null,
        unitCost: null,
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ isTracked: true });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.ITEM_TRACKED_STOCK_REQUIRED.code);
    });

    it('switches isTracked from false to true with valid stockQuantity and unitCost', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: false,
        stockQuantity: null,
        unitCost: null,
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ isTracked: true, stockQuantity: 20, unitCost: 10.0 });

      expect(res.status).toBe(200);
      expect(res.body.data.isTracked).toBe(true);
      expect(res.body.data.stockQuantity).toBe(20);
      expect(res.body.data.unitCost).toBe(10);
    });

    it('silently sets stockQuantity and unitCost to null when switching to untracked', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: true,
        stockQuantity: 15,
        unitCost: 8.0,
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ isTracked: false, stockQuantity: 50 });

      expect(res.status).toBe(200);
      expect(res.body.data.isTracked).toBe(false);
      expect(res.body.data.stockQuantity).toBeNull();
      expect(res.body.data.unitCost).toBeNull();
    });

    it('returns 422 when updating with a non-existent categoryId', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });
      const fakeCatId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ categoryId: fakeCatId });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('rejects non-https imageUrl with 422', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ imageUrl: 'http://insecure.com/pic.png' });

      expect(res.status).toBe(422);
    });

    it('rejects empty body with 422', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({});

      expect(res.status).toBe(422);
    });

    it('returns 404 for non-existent itemId', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .patch(`/api/v1/cafe/items/${fakeId}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ name: `${TEST_PREFIX}Ghost` });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.ITEM_NOT_FOUND.code);
    });

    it('rejects unauthorized roles (COACH, MEMBER) with 403', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const coachRes = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(coachUser))
        .send({ name: `${TEST_PREFIX}CoachAttempt` });
      expect(coachRes.status).toBe(403);

      const memberRes = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}`)
        .set('Authorization', bearerFor(memberUser))
        .send({ name: `${TEST_PREFIX}MemberAttempt` });
      expect(memberRes.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/cafe/items/:itemId/availability', () => {
    it('updates availability successfully (200)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: true,
        stockQuantity: 10,
        availability: 'AVAILABLE',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser))
        .send({ availability: 'sold_out' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availability).toBe('sold_out');

      // Now set back to available (stock is 10)
      const resRestore = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser))
        .send({ availability: 'available' });

      expect(resRestore.status).toBe(200);
      expect(resRestore.body.data.availability).toBe('available');
    });

    it('returns 400 when setting available while tracked stock is 0', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: true,
        stockQuantity: 0,
        availability: 'SOLD_OUT',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser))
        .send({ availability: 'available' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.ITEM_SOLD_OUT_ZERO_STOCK.code);
    });

    it('allows setting available on untracked items (no stock)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        isTracked: false,
        stockQuantity: null,
        unitCost: null,
        availability: 'SOLD_OUT',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser))
        .send({ availability: 'available' });

      expect(res.status).toBe(200);
      expect(res.body.data.availability).toBe('available');
    });

    it('rejects unauthorized roles with 403', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(coachUser))
        .send({ availability: 'sold_out' });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/cafe/items/:itemId/visibility', () => {
    it('updates visibility successfully (200)', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, {
        categoryId: defaultCategory.id,
        visibility: 'PUBLIC',
      });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/visibility`)
        .set('Authorization', bearerFor(adminUser))
        .send({ visibility: 'staff_only' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.visibility).toBe('staff_only');

      const resPublic = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/visibility`)
        .set('Authorization', bearerFor(ownerUser))
        .send({ visibility: 'public' });

      expect(resPublic.status).toBe(200);
      expect(resPublic.body.data.visibility).toBe('public');
    });

    it('rejects unauthorized roles with 403', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const res = await request(app)
        .patch(`/api/v1/cafe/items/${item.id}/visibility`)
        .set('Authorization', bearerFor(memberUser))
        .send({ visibility: 'staff_only' });

      expect(res.status).toBe(403);
    });
  });

  describe('405 Method Not Allowed handling on dedicated PATCH endpoints', () => {
    it('returns 405 on disallowed methods on /items/:itemId/availability', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const getRes = await request(app)
        .get(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser));
      expect(getRes.status).toBe(405);
      expect(getRes.headers.allow).toBe('PATCH');

      const postRes = await request(app)
        .post(`/api/v1/cafe/items/${item.id}/availability`)
        .set('Authorization', bearerFor(adminUser));
      expect(postRes.status).toBe(405);
      expect(postRes.headers.allow).toBe('PATCH');
    });

    it('returns 405 on disallowed methods on /items/:itemId/visibility', async () => {
      const item = await createTestCafeItem(TEST_PREFIX, { categoryId: defaultCategory.id });

      const getRes = await request(app)
        .get(`/api/v1/cafe/items/${item.id}/visibility`)
        .set('Authorization', bearerFor(adminUser));
      expect(getRes.status).toBe(405);
      expect(getRes.headers.allow).toBe('PATCH');
    });
  });
});

