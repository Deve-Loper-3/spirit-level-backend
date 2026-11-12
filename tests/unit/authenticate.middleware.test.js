const jwt = require('jsonwebtoken');

const mockAccessSecret = 'test-access-secret-at-least-32-characters-long';

jest.mock('../../src/config/env', () => ({
  JWT_ACCESS_SECRET: mockAccessSecret,
  JWT_ACCESS_EXPIRES_IN: '15m',
}));
jest.mock('../../src/repositories/user.repository', () => ({ findAuthById: jest.fn() }));

const { authenticate } = require('../../src/middlewares/authenticate.middleware');
const { findAuthById } = require('../../src/repositories/user.repository');
const { signAccessToken } = require('../../src/utils/jwt.util');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Messages } = require('../../src/constants/messages');

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';

const buildReq = (authorization) => ({ headers: authorization ? { authorization } : {} });
const bearer = (token) => `Bearer ${token}`;
const validToken = (role = Role.ADMIN) => signAccessToken({ userId: USER_ID, role });
const signRaw = (payload, options = {}) =>
  jwt.sign(payload, mockAccessSecret, { algorithm: 'HS256', subject: USER_ID, ...options });

const run = async (req) => {
  const next = jest.fn();
  await authenticate(req, {}, next);
  return { next, error: next.mock.calls[0][0] };
};

const expectAppError = (error, { statusCode, code }) => {
  expect(error).toMatchObject({ statusCode, code, isOperational: true });
};

describe('authenticate middleware', () => {
  beforeEach(() => {
    findAuthById.mockResolvedValue({
      id: USER_ID,
      email: 'admin@test.invalid',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
    });
  });

  describe('Authorization header', () => {
    it('returns 401 UNAUTHORIZED when the header is missing', async () => {
      const { error } = await run(buildReq());

      expectAppError(error, { statusCode: 401, code: 'UNAUTHORIZED' });
      expect(error.message).toBe(Messages.NO_TOKEN_PROVIDED);
      expect(findAuthById).not.toHaveBeenCalled();
    });

    it.each([
      ['wrong scheme', `Basic ${'abc'}`],
      ['no token after the scheme', 'Bearer'],
      ['empty token', 'Bearer '],
      ['extra parts', 'Bearer abc def'],
      ['token only', 'abc.def.ghi'],
    ])('returns 401 UNAUTHORIZED for a malformed header (%s)', async (_label, header) => {
      const { error } = await run(buildReq(header));

      expectAppError(error, { statusCode: 401, code: 'UNAUTHORIZED' });
      expect(findAuthById).not.toHaveBeenCalled();
    });

    it('accepts the scheme case-insensitively', async () => {
      const req = buildReq(`bearer ${validToken()}`);

      const { next, error } = await run(req);

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('token verification', () => {
    it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
      const token = signRaw({ type: 'access', role: Role.ADMIN }, { expiresIn: -10 });

      const { error } = await run(buildReq(bearer(token)));

      expectAppError(error, { statusCode: 401, code: 'TOKEN_EXPIRED' });
      expect(findAuthById).not.toHaveBeenCalled();
    });

    it('returns 401 INVALID_TOKEN for a garbage token', async () => {
      const { error } = await run(buildReq(bearer('not-a-jwt')));

      expectAppError(error, { statusCode: 401, code: 'INVALID_TOKEN' });
    });

    it('returns 401 INVALID_TOKEN for a token signed with another secret', async () => {
      const token = jwt.sign({ type: 'access' }, 'another-secret-that-is-also-32-characters', {
        algorithm: 'HS256',
        subject: USER_ID,
      });

      const { error } = await run(buildReq(bearer(token)));

      expectAppError(error, { statusCode: 401, code: 'INVALID_TOKEN' });
    });

    it('returns 401 INVALID_TOKEN for a token that is not an access token', async () => {
      const { error } = await run(buildReq(bearer(signRaw({ type: 'refresh' }))));

      expectAppError(error, { statusCode: 401, code: 'INVALID_TOKEN' });
    });

    it('returns 401 INVALID_TOKEN for a token without a subject', async () => {
      const token = jwt.sign({ type: 'access' }, mockAccessSecret, { algorithm: 'HS256' });

      const { error } = await run(buildReq(bearer(token)));

      expectAppError(error, { statusCode: 401, code: 'INVALID_TOKEN' });
      expect(findAuthById).not.toHaveBeenCalled();
    });
  });

  describe('user lookup', () => {
    it('returns 401 INVALID_TOKEN when the user does not exist', async () => {
      findAuthById.mockResolvedValue(null);

      const { error } = await run(buildReq(bearer(validToken())));

      expectAppError(error, { statusCode: 401, code: 'INVALID_TOKEN' });
      expect(findAuthById).toHaveBeenCalledWith(USER_ID);
    });

    it.each([
      [AccountStatus.PENDING, 'REGISTRATION_INCOMPLETE'],
      [AccountStatus.DISABLED, 'ACCOUNT_DISABLED'],
    ])('returns 403 for a %s user', async (status, code) => {
      findAuthById.mockResolvedValue({ id: USER_ID, role: Role.ADMIN, status });

      const { error } = await run(buildReq(bearer(validToken())));

      expectAppError(error, { statusCode: 403, code });
    });

    it('forwards unexpected errors (e.g. DB down) unchanged', async () => {
      const dbError = new Error('db down');
      findAuthById.mockRejectedValue(dbError);

      const { error } = await run(buildReq(bearer(validToken())));

      expect(error).toBe(dbError);
    });
  });

  describe('success', () => {
    it('sets req.user from the DB and calls next without an error', async () => {
      const req = buildReq(bearer(validToken()));

      const { next, error } = await run(req);

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({
        id: USER_ID,
        email: 'admin@test.invalid',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      });
    });

    it('uses the DB role when it differs from the token role', async () => {
      findAuthById.mockResolvedValue({
        id: USER_ID,
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
      });
      const req = buildReq(bearer(validToken(Role.OWNER)));

      await run(req);

      expect(req.user.role).toBe(Role.COACH);
    });
  });
});
