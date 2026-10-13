const { loginSchema } = require('../../src/validators/auth.validation');
const { Messages } = require('../../src/constants/messages');

const validInput = {
  email: 'member@test.invalid',
  password: 'Secret123',
};

const issueFor = (result, field) => result.error.issues.find((issue) => issue.path[0] === field);

describe('auth.validation - loginSchema', () => {
  it('accepts valid email and password', () => {
    const result = loginSchema.safeParse(validInput);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(validInput);
  });

  it('trims and lowercases the email', () => {
    const result = loginSchema.safeParse({ ...validInput, email: '  Member@Test.INVALID  ' });

    expect(result.success).toBe(true);
    expect(result.data.email).toBe('member@test.invalid');
  });

  it('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ ...validInput, email: 'not-an-email' });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'email').message).toBe(Messages.EMAIL_INVALID);
  });

  it('rejects a missing email', () => {
    const result = loginSchema.safeParse({ password: validInput.password });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'email').message).toBe(Messages.EMAIL_REQUIRED);
  });

  it('rejects a missing password', () => {
    const result = loginSchema.safeParse({ email: validInput.email });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'password').message).toBe(Messages.PASSWORD_REQUIRED);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ ...validInput, password: '' });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'password').message).toBe(Messages.PASSWORD_REQUIRED);
  });

  it('rejects a password longer than 72 characters', () => {
    const result = loginSchema.safeParse({ ...validInput, password: 'a'.repeat(73) });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'password').message).toBe(Messages.PASSWORD_MAX_LENGTH);
  });

  it('accepts a password of exactly 72 characters', () => {
    const result = loginSchema.safeParse({ ...validInput, password: 'a'.repeat(72) });

    expect(result.success).toBe(true);
  });

  it('rejects a non-string password', () => {
    const result = loginSchema.safeParse({ ...validInput, password: 12345678 });

    expect(result.success).toBe(false);
    expect(issueFor(result, 'password').message).toBe(Messages.PASSWORD_REQUIRED);
  });

  it('accepts a password that does not meet the registration policy', () => {
    const result = loginSchema.safeParse({ ...validInput, password: 'weak' });

    expect(result.success).toBe(true);
  });
});
