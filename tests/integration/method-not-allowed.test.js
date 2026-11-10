const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

// Wrong method on a real path: 405 METHOD_NOT_ALLOWED with an Allow header, never 404.
describe('405 METHOD_NOT_ALLOWED on every router', () => {
  it.each([
    ['get', '/api/v1/auth/login', 'POST'],
    ['put', '/api/v1/auth/register', 'POST'],
    ['post', '/api/v1/auth/me', 'GET'],
    ['get', '/api/v1/auth/forgot-password', 'POST'],
    ['get', '/api/v1/admin/staff', 'POST'],
    ['delete', '/api/v1/admin/staff/coaches', 'POST'],
    ['post', '/api/v1/coaches', 'GET'],
    ['post', '/api/v1/coaches/me', 'GET'],
    ['delete', '/api/v1/coaches/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', 'GET, PATCH'],
    ['get', '/api/v1/coaches/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e/status', 'PATCH'],
    ['get', '/api/v1/uploads/profile-image/token', 'POST'],
    ['post', '/api/v1/uploads/profile-image', 'PATCH'],
    ['post', '/health', 'GET'],
    ['post', '/health/ready', 'GET'],
  ])('%s %s -> 405, Allow: %s', async (method, url, allow) => {
    const res = await request(app)[method](url);

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe(allow);
    expect(res.body).toMatchObject({ success: false, code: 'METHOD_NOT_ALLOWED' });
  });

  it('an unknown path is still a plain 404 ROUTE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/auth/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('request body errors', () => {
  it('a missing body is 400 VALIDATION_ERROR on field "body"', async () => {
    const res = await request(app).post('/api/v1/auth/login');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'body', message: 'Request body is required' }],
    });
  });
});
