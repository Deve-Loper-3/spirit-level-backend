const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(30000);

const ME_URL = '/api/v1/auth/me';

describe('GET /api/v1/auth/me', () => {
  const testData = createTestData('auth_me');
  let app;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const getMe = (authorization) => {
    const req = request(app).get(ME_URL);
    return authorization ? req.set('Authorization', authorization) : req;
  };

  it.each(Object.values(Role))('returns the profile of an active %s', async (role) => {
    const user = await testData.createUser({ role });

    const res = await getMe(bearerFor(user));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: Messages.PROFILE_FETCHED_SUCCESS });
    expect(res.body.data.user).toMatchObject({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role,
      status: AccountStatus.ACTIVE,
    });
  });

  it('never returns the password hash or other internal fields', async () => {
    const user = await testData.createUser();

    const res = await getMe(bearerFor(user));

    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user).not.toHaveProperty('mustChangePassword');
    expect(JSON.stringify(res.body)).not.toContain(user.passwordHash);
  });

  it('returns 401 when no token is sent', async () => {
    const res = await getMe();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: Messages.NO_TOKEN_PROVIDED });
  });

  it('returns 401 INVALID_TOKEN for an invalid token', async () => {
    const res = await getMe('Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const user = await testData.createUser();
    const expired = jwt.sign({ sub: user.id, type: 'access' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });

    const res = await getMe(`Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: Messages.TOKEN_EXPIRED });
  });

  it('returns 401 INVALID_TOKEN when the token user no longer exists', async () => {
    const res = await getMe(bearerFor({ id: crypto.randomUUID(), role: Role.MEMBER }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
  });

  it.each([
    [AccountStatus.DISABLED, Messages.ACCOUNT_DISABLED],
    [AccountStatus.PENDING, Messages.REGISTRATION_INCOMPLETE],
  ])('returns 403 for a %s account', async (status, message) => {
    const user = await testData.createUser({ status });

    const res = await getMe(bearerFor(user));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message });
  });
});
