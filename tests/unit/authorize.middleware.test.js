const { authorize } = require('../../src/middlewares/authorize.middleware');
const { Role } = require('../../src/constants/roles');

const run = (middleware, req) => {
  const next = jest.fn();
  middleware(req, {}, next);
  return { next, error: next.mock.calls[0][0] };
};

describe('authorize middleware', () => {
  const adminOrOwner = authorize(Role.ADMIN, Role.OWNER);

  it('calls next without an error when the role is allowed', () => {
    const { next, error } = run(adminOrOwner, { user: { role: Role.ADMIN } });

    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });

  it('allows every listed role', () => {
    expect(run(adminOrOwner, { user: { role: Role.OWNER } }).error).toBeUndefined();
  });

  it.each([Role.COACH, Role.MEMBER])('returns 403 FORBIDDEN for %s', (role) => {
    const { error } = run(adminOrOwner, { user: { role } });

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', isOperational: true });
  });

  it('returns 401 UNAUTHORIZED when req.user is missing', () => {
    const { error } = run(adminOrOwner, {});

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', isOperational: true });
  });

  it('denies everyone when no roles are allowed', () => {
    const { error } = run(authorize(), { user: { role: Role.OWNER } });

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});
