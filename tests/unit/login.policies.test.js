const { assertCanLogin } = require('../../src/services/login.policies');
const { AccountStatus } = require('../../src/constants/status');
const { AppErrors } = require('../../src/constants/errors');

const getThrown = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('login.policies - assertCanLogin', () => {
  it('allows an ACTIVE user', () => {
    expect(() => assertCanLogin({ status: AccountStatus.ACTIVE })).not.toThrow();
  });

  it('rejects a PENDING user with REGISTRATION_INCOMPLETE (403)', () => {
    const error = getThrown(() => assertCanLogin({ status: AccountStatus.PENDING }));

    expect(error).toMatchObject({
      statusCode: 403,
      code: AppErrors.REGISTRATION_INCOMPLETE.code,
      message: AppErrors.REGISTRATION_INCOMPLETE.message,
      isOperational: true,
    });
  });

  it('rejects a DISABLED user with ACCOUNT_DISABLED (403)', () => {
    const error = getThrown(() => assertCanLogin({ status: AccountStatus.DISABLED }));

    expect(error).toMatchObject({
      statusCode: 403,
      code: AppErrors.ACCOUNT_DISABLED.code,
      message: AppErrors.ACCOUNT_DISABLED.message,
      isOperational: true,
    });
  });

  it.each(['SUSPENDED', 'active', '', 'constructor', '__proto__', 'toString'])(
    'rejects unknown status %j with ACCOUNT_DISABLED',
    (status) => {
      const error = getThrown(() => assertCanLogin({ status }));

      expect(error).toMatchObject({ statusCode: 403, code: AppErrors.ACCOUNT_DISABLED.code });
    },
  );

  it.each([
    ['undefined', { status: undefined }],
    ['null', { status: null }],
    ['absent', {}],
  ])('rejects a user whose status is %s with ACCOUNT_DISABLED', (_label, user) => {
    const error = getThrown(() => assertCanLogin(user));

    expect(error).toMatchObject({ statusCode: 403, code: AppErrors.ACCOUNT_DISABLED.code });
  });
});
