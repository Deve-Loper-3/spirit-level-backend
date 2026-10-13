const {
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  registerSchema,
} = require('../../src/validators/auth.validation');
const { Messages } = require('../../src/constants/messages');
const { PASSWORD_POLICY_MESSAGE } = require('../../src/utils/password.util');

const messagesOf = (result) => result.error.issues.map((issue) => issue.message);
const pathsOf = (result) => result.error.issues.map((issue) => issue.path.join('.'));

describe('password reset validation', () => {
  describe('forgotPasswordSchema', () => {
    it('accepts a valid email and trims + lowercases it', () => {
      const result = forgotPasswordSchema.safeParse({ email: '  Jane.Doe@Example.COM ' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ email: 'jane.doe@example.com' });
    });

    it('rejects a missing email', () => {
      const result = forgotPasswordSchema.safeParse({});

      expect(result.success).toBe(false);
      expect(messagesOf(result)).toContain(Messages.EMAIL_REQUIRED);
    });

    it('rejects an invalid email', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'not-an-email' });

      expect(result.success).toBe(false);
      expect(messagesOf(result)).toContain(Messages.EMAIL_INVALID);
    });

    it('strips unknown keys', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'a@b.com', role: 'ADMIN' });

      expect(result.data).toEqual({ email: 'a@b.com' });
    });
  });

  describe('verifyOtpSchema', () => {
    const valid = { email: 'jane@example.com', otp: '0042' };

    it('accepts a 4-digit OTP and keeps leading zeros', () => {
      const result = verifyOtpSchema.safeParse(valid);

      expect(result.success).toBe(true);
      expect(result.data.otp).toBe('0042');
    });

    it('trims the OTP and normalizes the email', () => {
      const result = verifyOtpSchema.safeParse({ email: ' JANE@example.com ', otp: ' 1234 ' });

      expect(result.data).toEqual({ email: 'jane@example.com', otp: '1234' });
    });

    it.each(['123', '12345', '123456', '12a4', '12 4', '', '١٢٣٤'])(
      'rejects the OTP %p with the format message',
      (otp) => {
        const result = verifyOtpSchema.safeParse({ ...valid, otp });

        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain(Messages.OTP_FORMAT_INVALID);
      },
    );

    it('rejects a missing or non-string OTP with the required message', () => {
      for (const body of [{ email: valid.email }, { ...valid, otp: 1234 }]) {
        const result = verifyOtpSchema.safeParse(body);

        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain(Messages.OTP_REQUIRED);
      }
    });

    it('rejects a missing or invalid email', () => {
      expect(verifyOtpSchema.safeParse({ otp: '1234' }).success).toBe(false);
      expect(verifyOtpSchema.safeParse({ email: 'nope', otp: '1234' }).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    const valid = {
      email: 'jane@example.com',
      resetToken: 'some-reset-token',
      newPassword: 'NewPassw0rd',
    };

    it('accepts valid input', () => {
      const result = resetPasswordSchema.safeParse(valid);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(valid);
    });

    it('normalizes the email and trims the reset token', () => {
      const result = resetPasswordSchema.safeParse({
        ...valid,
        email: ' JANE@Example.com ',
        resetToken: '  tok  ',
      });

      expect(result.data.email).toBe('jane@example.com');
      expect(result.data.resetToken).toBe('tok');
    });

    it('rejects a missing, empty or blank reset token', () => {
      for (const resetToken of [undefined, '', '   ', 42]) {
        const result = resetPasswordSchema.safeParse({ ...valid, resetToken });

        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain(Messages.RESET_TOKEN_REQUIRED);
        expect(pathsOf(result)).toContain('resetToken');
      }
    });

    it('rejects a missing new password with the required message', () => {
      const result = resetPasswordSchema.safeParse({ ...valid, newPassword: undefined });

      expect(result.success).toBe(false);
      expect(messagesOf(result)).toContain(Messages.PASSWORD_REQUIRED);
    });

    it.each(['short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere'])(
      'rejects the weak password %p with the policy message',
      (newPassword) => {
        const result = resetPasswordSchema.safeParse({ ...valid, newPassword });

        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain(PASSWORD_POLICY_MESSAGE);
      },
    );

    it('accepts exactly 72 characters and rejects 73', () => {
      const base = 'Aa1';
      const ok = base + 'x'.repeat(72 - base.length);

      expect(resetPasswordSchema.safeParse({ ...valid, newPassword: ok }).success).toBe(true);

      const tooLong = resetPasswordSchema.safeParse({ ...valid, newPassword: `${ok}x` });
      expect(tooLong.success).toBe(false);
      expect(messagesOf(tooLong)).toContain(Messages.PASSWORD_MAX_LENGTH);
    });

    it('uses the same password rules as registration', () => {
      const registerBase = {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+12025551234',
        gender: 'FEMALE',
      };

      for (const password of ['NewPassw0rd', 'weak', 'x'.repeat(73)]) {
        expect(registerSchema.safeParse({ ...registerBase, password }).success).toBe(
          resetPasswordSchema.safeParse({ ...valid, newPassword: password }).success,
        );
      }
    });
  });
});
