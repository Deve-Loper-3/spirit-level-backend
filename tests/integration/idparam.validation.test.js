const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

const app = createApp();
const testData = createTestData('idparam');

// Malformed path ids are a 400 VALIDATION_ERROR everywhere (plans, classes, slots, sessions),
// checked after authentication and authorization.
describe('malformed path ids return 400 VALIDATION_ERROR', () => {
  let admin;

  beforeAll(async () => {
    admin = await testData.createUser({ role: Role.ADMIN });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const BAD = 'not-a-uuid';
  const GOOD = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

  it.each([
    ['get', `/api/v1/plans/${BAD}`, 'id', 'Plan id must be a valid UUID'],
    ['patch', `/api/v1/plans/${BAD}`, 'id', 'Plan id must be a valid UUID'],
    ['patch', `/api/v1/plans/${BAD}/status`, 'id', 'Plan id must be a valid UUID'],
    ['get', `/api/v1/classes/${BAD}`, 'id', 'Class id must be a valid UUID'],
    ['patch', `/api/v1/classes/${BAD}`, 'id', 'Class id must be a valid UUID'],
    ['post', `/api/v1/classes/${BAD}/activate`, 'id', 'Class id must be a valid UUID'],
    ['get', `/api/v1/classes/${BAD}/slots`, 'id', 'Class id must be a valid UUID'],
    ['patch', `/api/v1/classes/${GOOD}/slots/${BAD}`, 'slotId', 'Slot id must be a valid UUID'],
    ['delete', `/api/v1/classes/${GOOD}/slots/${BAD}`, 'slotId', 'Slot id must be a valid UUID'],
    ['get', `/api/v1/sessions/${BAD}`, 'id', 'Session id must be a valid UUID'],
    ['patch', `/api/v1/sessions/${BAD}`, 'id', 'Session id must be a valid UUID'],
    ['post', `/api/v1/sessions/${BAD}/cancel`, 'id', 'Session id must be a valid UUID'],
    ['post', `/api/v1/sessions/${BAD}/restore`, 'id', 'Session id must be a valid UUID'],
  ])('%s %s', async (method, url, field, message) => {
    const res = await request(app)[method](url).set('Authorization', bearerFor(admin)).send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('a well-formed but unknown id is still a 404', async () => {
    const res = await request(app)
      .get(`/api/v1/classes/${GOOD}`)
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(404);
  });

  it('checks authentication before the id: no token gives 401, not 400', async () => {
    const res = await request(app).get(`/api/v1/plans/${BAD}`);
    expect(res.status).toBe(401);
  });
});
