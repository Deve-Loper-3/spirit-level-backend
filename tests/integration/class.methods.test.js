const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestClasses, createTestClass } = require('../helpers/class.helper');

jest.setTimeout(35000);

describe('405 METHOD_NOT_ALLOWED for Class routes', () => {
  const PREFIX = 'test_slcls_methods_';
  const testData = createTestData('slcls_methods');
  let app;
  let adminUser;
  let testClass;

  beforeAll(async () => {
    app = createApp();
    await deleteTestClasses(PREFIX);
    adminUser = await testData.createUser({ role: Role.ADMIN });
    testClass = await createTestClass(PREFIX, { name: `${PREFIX}Class` });
  });

  afterAll(async () => {
    await deleteTestClasses(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('/api/v1/classes returns 405 with Allow: GET, POST for DELETE/PUT/PATCH', async () => {
    const resDelete = await request(app)
      .delete('/api/v1/classes')
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('GET, POST');
    expect(resDelete.body.code).toBe('METHOD_NOT_ALLOWED');

    const resPut = await request(app)
      .put('/api/v1/classes')
      .set('Authorization', bearerFor(adminUser));
    expect(resPut.status).toBe(405);
    expect(resPut.headers.allow).toBe('GET, POST');

    const resPatch = await request(app)
      .patch('/api/v1/classes')
      .set('Authorization', bearerFor(adminUser));
    expect(resPatch.status).toBe(405);
    expect(resPatch.headers.allow).toBe('GET, POST');
  });

  it('/api/v1/classes/:id returns 405 with Allow: GET, PATCH for POST/PUT/DELETE', async () => {
    const resPost = await request(app)
      .post(`/api/v1/classes/${testClass.id}`)
      .set('Authorization', bearerFor(adminUser));
    expect(resPost.status).toBe(405);
    expect(resPost.headers.allow).toBe('GET, PATCH');

    const resDelete = await request(app)
      .delete(`/api/v1/classes/${testClass.id}`)
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('GET, PATCH');

    const resPut = await request(app)
      .put(`/api/v1/classes/${testClass.id}`)
      .set('Authorization', bearerFor(adminUser));
    expect(resPut.status).toBe(405);
    expect(resPut.headers.allow).toBe('GET, PATCH');
  });

  it('/api/v1/classes/:id/deactivate returns 405 with Allow: POST for GET/PUT/PATCH/DELETE', async () => {
    const resGet = await request(app)
      .get(`/api/v1/classes/${testClass.id}/deactivate`)
      .set('Authorization', bearerFor(adminUser));
    expect(resGet.status).toBe(405);
    expect(resGet.headers.allow).toBe('POST');

    const resDelete = await request(app)
      .delete(`/api/v1/classes/${testClass.id}/deactivate`)
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('POST');
  });

  it('/api/v1/classes/:id/activate returns 405 with Allow: POST for GET/PUT/PATCH/DELETE', async () => {
    const resGet = await request(app)
      .get(`/api/v1/classes/${testClass.id}/activate`)
      .set('Authorization', bearerFor(adminUser));
    expect(resGet.status).toBe(405);
    expect(resGet.headers.allow).toBe('POST');

    const resDelete = await request(app)
      .delete(`/api/v1/classes/${testClass.id}/activate`)
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('POST');
  });

  it('/api/v1/classes/:id/archive returns 405 with Allow: POST for GET/PUT/PATCH/DELETE', async () => {
    const resGet = await request(app)
      .get(`/api/v1/classes/${testClass.id}/archive`)
      .set('Authorization', bearerFor(adminUser));
    expect(resGet.status).toBe(405);
    expect(resGet.headers.allow).toBe('POST');

    const resDelete = await request(app)
      .delete(`/api/v1/classes/${testClass.id}/archive`)
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('POST');
  });

  it('/api/v1/classes/:id/eligibility returns 405 with Allow: PUT for GET/POST/PATCH/DELETE', async () => {
    const resGet = await request(app)
      .get(`/api/v1/classes/${testClass.id}/eligibility`)
      .set('Authorization', bearerFor(adminUser));
    expect(resGet.status).toBe(405);
    expect(resGet.headers.allow).toBe('PUT');

    const resDelete = await request(app)
      .delete(`/api/v1/classes/${testClass.id}/eligibility`)
      .set('Authorization', bearerFor(adminUser));
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.allow).toBe('PUT');
  });
});
