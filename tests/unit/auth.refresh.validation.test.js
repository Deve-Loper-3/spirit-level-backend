const { refreshTokenSchema } = require('../../src/validators/auth.validation');
const { Messages } = require('../../src/constants/messages');

const issuesOf = (input) => {
  const result = refreshTokenSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('refreshTokenSchema', () => {
  it('accepts a refresh token and trims it', () => {
    const result = refreshTokenSchema.safeParse({ refreshToken: '  abc123  ' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ refreshToken: 'abc123' });
  });

  it('strips unknown keys', () => {
    const result = refreshTokenSchema.safeParse({ refreshToken: 'abc', userId: 'x' });

    expect(result.data).toEqual({ refreshToken: 'abc' });
  });

  it.each([
    ['missing body field', {}],
    ['empty string', { refreshToken: '' }],
    ['blank string', { refreshToken: '   ' }],
    ['null', { refreshToken: null }],
    ['number', { refreshToken: 123 }],
    ['object', { refreshToken: {} }],
  ])('rejects %s with REFRESH_TOKEN_REQUIRED', (_label, input) => {
    expect(issuesOf(input)).toEqual([Messages.REFRESH_TOKEN_REQUIRED]);
  });
});
