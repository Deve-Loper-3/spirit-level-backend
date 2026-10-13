const {
  generateTempPassword,
  hashPassword,
  comparePassword,
  PASSWORD_REGEX,
} = require('../../src/utils/password.util');

describe('password.util', () => {
  describe('generateTempPassword', () => {
    it('generates a password of default length 16', () => {
      const password = generateTempPassword();
      expect(typeof password).toBe('string');
      expect(password.length).toBe(16);
    });

    it('enforces a minimum length of 12 characters when requested length is smaller', () => {
      const password = generateTempPassword(8);
      expect(password.length).toBe(12);
    });

    it('supports custom lengths greater than or equal to 12', () => {
      const password = generateTempPassword(24);
      expect(password.length).toBe(24);
    });

    it('satisfies the application PASSWORD_REGEX policy', () => {
      for (let i = 0; i < 20; i += 1) {
        const password = generateTempPassword();
        expect(PASSWORD_REGEX.test(password)).toBe(true);
      }
    });

    it('contains at least one uppercase letter, one lowercase letter, one digit, and one symbol', () => {
      const uppercase = /[A-Z]/;
      const lowercase = /[a-z]/;
      const digit = /[0-9]/;
      const symbol = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/;

      for (let i = 0; i < 20; i += 1) {
        const password = generateTempPassword();
        expect(uppercase.test(password)).toBe(true);
        expect(lowercase.test(password)).toBe(true);
        expect(digit.test(password)).toBe(true);
        expect(symbol.test(password)).toBe(true);
      }
    });

    it('generates distinct passwords across multiple calls', () => {
      const passwords = new Set();
      for (let i = 0; i < 50; i += 1) {
        passwords.add(generateTempPassword());
      }
      expect(passwords.size).toBe(50);
    });
  });

  describe('hashPassword and comparePassword', () => {
    it('hashes a plain password using bcrypt and successfully compares it', async () => {
      const plain = 'TempP@ssw0rd!123';
      const hash = await hashPassword(plain);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(plain);
      expect(hash).toMatch(/^\$2[aby]\$\d+\$/);

      const isValid = await comparePassword(plain, hash);
      expect(isValid).toBe(true);

      const isInvalid = await comparePassword('WrongP@ssw0rd!456', hash);
      expect(isInvalid).toBe(false);
    });
  });
});
