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

jest.setTimeout(35000);

describe('Cafe Category Endpoints', () => {
  const TEST_PREFIX = 'test_cat_';
  const testData = createTestData('cafe_cat');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;

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
  });

  afterAll(async () => {
    await cleanup();
    await testData.cleanup();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('POST /api/v1/cafe/categories', () => {
    it('creates a category with valid name and description (201)', async () => {
      const name = `${TEST_PREFIX}Smoothies_${Date.now()}`;
      const res = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .send({ name, description: 'Fresh smoothies' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(Messages.CATEGORY_CREATED_SUCCESS);
      expect(res.body.data.name).toBe(name);
      expect(res.body.data.description).toBe('Fresh smoothies');
      expect(res.body.data.itemCount).toBe(0);
      expect(res.headers.location).toBe(`/api/v1/cafe/categories/${res.body.data.id}`);
    });

    it('trims whitespace from name and description', async () => {
      const uniqueSuffix = Date.now();
      const rawName = `  ${TEST_PREFIX}Snacks_${uniqueSuffix}   `;
      const res = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(ownerUser))
        .send({ name: rawName, description: '  Healthy snacks  ' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(`${TEST_PREFIX}Snacks_${uniqueSuffix}`);
      expect(res.body.data.description).toBe('Healthy snacks');
    });

    it('rejects duplicate category name case-insensitively (409)', async () => {
      const name = `${TEST_PREFIX}Beverages_${Date.now()}`;
      await createTestCafeCategory(TEST_PREFIX, { name });

      const res = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .send({ name: name.toUpperCase() });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(AppErrors.CATEGORY_EXISTS.code);
    });

    it('rejects empty or whitespace name with 422', async () => {
      const res = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .send({ name: '   ' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
    });

    it('rejects name exceeding 80 characters with 422', async () => {
      const res = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser))
        .send({ name: 'A'.repeat(81) });

      expect(res.status).toBe(422);
    });

    it('rejects unauthorized roles (COACH, MEMBER) with 403', async () => {
      const coachRes = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(coachUser))
        .send({ name: `${TEST_PREFIX}Unauthorized` });
      expect(coachRes.status).toBe(403);

      const memberRes = await request(app)
        .post('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(memberUser))
        .send({ name: `${TEST_PREFIX}Unauthorized` });
      expect(memberRes.status).toBe(403);
    });
  });

  describe('GET /api/v1/cafe/categories', () => {
    it('returns categories sorted by name ascending with itemCount', async () => {
      const catB = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}B_Cat` });
      await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}A_Cat` });
      await createTestCafeItem(TEST_PREFIX, { categoryId: catB.id });

      const res = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const testCats = res.body.data.filter((c) => c.name.startsWith(TEST_PREFIX));
      expect(testCats.length).toBe(2);
      expect(testCats[0].name).toBe(`${TEST_PREFIX}A_Cat`);
      expect(testCats[0].itemCount).toBe(0); // empty category still shown
      expect(testCats[1].name).toBe(`${TEST_PREFIX}B_Cat`);
      expect(testCats[1].itemCount).toBe(1);
    });

    it('MEMBER role counts public items only in itemCount', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}Mix` });
      await createTestCafeItem(TEST_PREFIX, {
        categoryId: cat.id,
        visibility: 'PUBLIC',
      });
      await createTestCafeItem(TEST_PREFIX, {
        categoryId: cat.id,
        visibility: 'STAFF_ONLY',
      });

      // Member should see itemCount = 1
      const memberRes = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(memberUser));
      const memberCat = memberRes.body.data.find((c) => c.id === cat.id);
      expect(memberCat.itemCount).toBe(1);

      // Staff (Admin/Coach) should see total itemCount = 2
      const staffRes = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser));
      const staffCat = staffRes.body.data.find((c) => c.id === cat.id);
      expect(staffCat.itemCount).toBe(2);

      const coachRes = await request(app)
        .get('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(coachUser));
      const coachCat = coachRes.body.data.find((c) => c.id === cat.id);
      expect(coachCat.itemCount).toBe(2);
    });

    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/cafe/categories');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/cafe/categories/:categoryId', () => {
    it('updates name and description successfully (200)', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}OldName` });
      const newName = `${TEST_PREFIX}NewName_${Date.now()}`;

      const res = await request(app)
        .patch(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ name: newName, description: 'Updated desc' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newName);
      expect(res.body.data.description).toBe('Updated desc');
    });

    it('rejects duplicate name when renaming (409)', async () => {
      const cat1 = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}First` });
      const cat2 = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}Second` });

      const res = await request(app)
        .patch(`/api/v1/cafe/categories/${cat2.id}`)
        .set('Authorization', bearerFor(ownerUser))
        .send({ name: cat1.name.toLowerCase() });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(AppErrors.CATEGORY_EXISTS.code);
    });

    it('returns 404 if category does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .patch(`/api/v1/cafe/categories/${fakeId}`)
        .set('Authorization', bearerFor(adminUser))
        .send({ name: `${TEST_PREFIX}NonExistent` });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.CATEGORY_NOT_FOUND.code);
    });

    it('rejects empty body with 422', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX);
      const res = await request(app)
        .patch(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(adminUser))
        .send({});

      expect(res.status).toBe(422);
    });

    it('rejects unauthorized roles (COACH, MEMBER) with 403', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX);
      const res = await request(app)
        .patch(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(coachUser))
        .send({ name: `${TEST_PREFIX}TryUpdate` });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/cafe/categories/:categoryId', () => {
    it('deletes category with 0 items (200)', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}ToDelete` });

      const res = await request(app)
        .delete(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const lookup = await prisma.cafeCategory.findUnique({ where: { id: cat.id } });
      expect(lookup).toBeNull();
    });

    it('returns 409 CATEGORY_HAS_ITEMS if category has items', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX, { name: `${TEST_PREFIX}HasItem` });
      await createTestCafeItem(TEST_PREFIX, { categoryId: cat.id });

      const res = await request(app)
        .delete(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(ownerUser));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(AppErrors.CATEGORY_HAS_ITEMS.code);
      expect(res.body.message).toBe(Messages.CATEGORY_HAS_ITEMS);
    });

    it('returns 404 if category does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .delete(`/api/v1/cafe/categories/${fakeId}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(AppErrors.CATEGORY_NOT_FOUND.code);
    });

    it('rejects unauthorized roles with 403', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX);
      const res = await request(app)
        .delete(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(memberUser));

      expect(res.status).toBe(403);
    });
  });

  describe('405 Method Not Allowed handling', () => {
    it('returns 405 on disallowed methods on /categories', async () => {
      const res = await request(app)
        .put('/api/v1/cafe/categories')
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toContain('GET');
      expect(res.headers.allow).toContain('POST');
    });

    it('returns 405 on disallowed methods on /categories/:categoryId', async () => {
      const cat = await createTestCafeCategory(TEST_PREFIX);
      const res = await request(app)
        .get(`/api/v1/cafe/categories/${cat.id}`)
        .set('Authorization', bearerFor(adminUser));

      expect(res.status).toBe(405);
      expect(res.headers.allow).toContain('PATCH');
      expect(res.headers.allow).toContain('DELETE');
    });
  });
});
