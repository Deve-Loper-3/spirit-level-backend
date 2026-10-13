const { generateOtp, OTP_LENGTH } = require('../../src/utils/otp.util');

describe('otp.util', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateOtp', () => {
    it('returns a string of exactly 4 digits', () => {
      for (let i = 0; i < 200; i += 1) {
        expect(generateOtp()).toMatch(/^\d{4}$/);
      }
      expect(OTP_LENGTH).toBe(4);
    });

    it('keeps leading zeros (zero-padded)', () => {
      jest.spyOn(require('crypto'), 'randomInt').mockReturnValueOnce(42);

      expect(generateOtp()).toBe('0042');
    });

    it('asks crypto.randomInt for a value in 0..9999', () => {
      const spy = jest.spyOn(require('crypto'), 'randomInt');

      generateOtp();

      expect(spy).toHaveBeenCalledWith(0, 10000);
    });

    it('does not return the same code every time', () => {
      const codes = new Set(Array.from({ length: 50 }, generateOtp));

      expect(codes.size).toBeGreaterThan(1);
    });
  });
});
