const { generateRefreshToken, hashToken } = require('../../src/utils/token.util');

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

describe('token.util', () => {
  describe('generateRefreshToken', () => {
    it('returns a 43-character base64url string (32 random bytes)', () => {
      expect(generateRefreshToken()).toMatch(BASE64URL_43);
    });

    it('returns a unique token on every call', () => {
      const tokens = new Set(Array.from({ length: 100 }, generateRefreshToken));

      expect(tokens.size).toBe(100);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-character SHA-256 hex digest that differs from the raw token', () => {
      const token = generateRefreshToken();
      const hash = hashToken(token);

      expect(hash).toMatch(SHA256_HEX);
      expect(hash).not.toBe(token);
    });

    it('is deterministic for the same token', () => {
      const token = generateRefreshToken();

      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('gives different hashes for different tokens', () => {
      expect(hashToken(generateRefreshToken())).not.toBe(hashToken(generateRefreshToken()));
    });
  });
});
