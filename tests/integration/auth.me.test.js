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
const { signAccessToken } = require('../../src/utils/jwt.util');

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

  describe('success per role', () => {
    it.each([Role.MEMBER, Role.COACH, Role.ADMIN, Role.OWNER])(
      'returns 200 with safe user fields only for %s',
      async (role) => {
        const user = await testData.createUser({
          role,
          fullName: `Test ${role}`,
          whatsappNumber: '+12025550188',
          birthDay: 10,
          birthMonth: 4,
          profileImageUrl: 'https://blob.example.com/test.png',
        });

        const res = await getMe(bearerFor(user));

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          success: true,
          message: Messages.SUCCESS,
          data: {
            id: user.id,
            fullName: `Test ${role}`,
            email: user.email,
            phone: user.phone,
            whatsappNumber: '+12025550188',
            gender: user.gender,
            birthDay: 10,
            birthMonth: 4,
            profileImageUrl: 'https://blob.example.com/test.png',
            role,
            status: AccountStatus.ACTIVE,
            createdAt: user.createdAt.toISOString(),
          },
        });

        // Strict assertion: sensitive/internal fields must never leak
        expect(res.body.data.passwordHash).toBeUndefined();
        expect(res.body.data.password).toBeUndefined();
        expect(res.body.data.mustChangePassword).toBeUndefined();
        expect(res.body.data.lastLoginAt).toBeUndefined();
        expect(res.body.data.waiverAcceptedAt).toBeUndefined();
        expect(res.body.data.registrationCompletedAt).toBeUndefined();
      },
    );
  });

  describe('authentication failure (401)', () => {
    it('returns 401 when no token is sent', async () => {
      const res = await getMe();

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: Messages.NO_TOKEN_PROVIDED,
      });
    });

    it('returns 401 INVALID_TOKEN for an invalid token', async () => {
      const res = await getMe('Bearer not-a-valid-jwt');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: Messages.INVALID_TOKEN,
      });
    });

    it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
      const user = await testData.createUser();
      const expiredToken = jwt.sign(
        { role: user.role, type: 'access' },
        env.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          subject: user.id,
          expiresIn: -10,
        },
      );

      const res = await getMe(`Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: Messages.TOKEN_EXPIRED,
      });
    });

    it('returns 401 INVALID_TOKEN when the user no longer exists in DB', async () => {
      const ghostToken = signAccessToken({
        userId: crypto.randomUUID(),
        role: Role.MEMBER,
      });

      const res = await getMe(`Bearer ${ghostToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        message: Messages.INVALID_TOKEN,
      });
    });
  });

  describe('account status restriction (403)', () => {
    it('returns 403 ACCOUNT_DISABLED for a DISABLED user', async () => {
      const user = await testData.createUser({ status: AccountStatus.DISABLED });

      const res = await getMe(bearerFor(user));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: Messages.ACCOUNT_DISABLED,
      });
    });

    it('returns 403 REGISTRATION_INCOMPLETE for a PENDING user', async () => {
      const user = await testData.createUser({ status: AccountStatus.PENDING });

      const res = await getMe(bearerFor(user));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: Messages.REGISTRATION_INCOMPLETE,
      });
    });
  });
});
