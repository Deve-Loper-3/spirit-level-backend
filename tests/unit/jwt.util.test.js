const jwt = require('jsonwebtoken');

const mockAccessSecret = 'test-access-secret-at-least-32-characters-long';

jest.mock('../../src/config/env', () => ({
  JWT_ACCESS_SECRET: mockAccessSecret,
  JWT_ACCESS_EXPIRES_IN: '15m',
}));

const { signAccessToken, verifyAccessToken } = require('../../src/utils/jwt.util');
const { Role } = require('../../src/constants/roles');

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60;

const base64UrlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('jwt.util', () => {
  describe('signAccessToken', () => {
    it('sets sub, role and type claims', () => {
      const payload = jwt.decode(signAccessToken({ userId: USER_ID, role: Role.MEMBER }));

      expect(payload).toMatchObject({ sub: USER_ID, role: Role.MEMBER, type: 'access' });
    });

    it('expires after the configured JWT_ACCESS_EXPIRES_IN', () => {
      const { iat, exp } = jwt.decode(signAccessToken({ userId: USER_ID, role: Role.MEMBER }));

      expect(exp - iat).toBe(FIFTEEN_MINUTES_IN_SECONDS);
    });

    it('signs with HS256', () => {
      const { header } = jwt.decode(signAccessToken({ userId: USER_ID, role: Role.MEMBER }), {
        complete: true,
      });

      expect(header.alg).toBe('HS256');
    });
  });

  describe('verifyAccessToken', () => {
    it('returns the payload for a valid access token', () => {
      const token = signAccessToken({ userId: USER_ID, role: Role.COACH });

      expect(verifyAccessToken(token)).toMatchObject({
        sub: USER_ID,
        role: Role.COACH,
        type: 'access',
      });
    });

    it('rejects a token signed with another secret', () => {
      const token = jwt.sign({ type: 'access' }, 'another-secret-that-is-also-32-characters', {
        algorithm: 'HS256',
        subject: USER_ID,
      });

      expect(() => verifyAccessToken(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects a token signed with another HMAC algorithm', () => {
      const token = jwt.sign({ type: 'access' }, mockAccessSecret, {
        algorithm: 'HS512',
        subject: USER_ID,
      });

      expect(() => verifyAccessToken(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects an unsigned token (alg none)', () => {
      const token = `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson({ sub: USER_ID, type: 'access' })}.`;

      expect(() => verifyAccessToken(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects a token whose type is not access', () => {
      const token = jwt.sign({ type: 'refresh' }, mockAccessSecret, {
        algorithm: 'HS256',
        subject: USER_ID,
      });

      expect(() => verifyAccessToken(token)).toThrow('invalid token type');
    });

    it('rejects an expired token', () => {
      const token = jwt.sign({ type: 'access' }, mockAccessSecret, {
        algorithm: 'HS256',
        subject: USER_ID,
        expiresIn: -10,
      });

      expect(() => verifyAccessToken(token)).toThrow(jwt.TokenExpiredError);
    });
  });
});
