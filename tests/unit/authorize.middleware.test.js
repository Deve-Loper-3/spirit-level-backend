jest.mock('../../src/config/logger', () => ({ warn: jest.fn() }));

const logger = require('../../src/config/logger');
const { authorize } = require('../../src/middlewares/authorize.middleware');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');

const run = (middleware, req) => {
  const next = jest.fn();
  middleware(req, {}, next);
  return { next, error: next.mock.calls[0][0] };
};

const buildRequest = (user) => ({
  user,
  method: 'POST',
  originalUrl: '/api/v1/admin/staff?token=secret',
  ip: '203.0.113.9',
  clientType: 'mobile',
  headers: { authorization: 'Bearer secret-token' },
  get: () => undefined,
});

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
    const { error } = run(adminOrOwner, buildRequest({ id: 'user-1', role }));

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', isOperational: true });
  });

  it('returns 401 UNAUTHORIZED when req.user is missing', () => {
    const { error } = run(adminOrOwner, {});

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', isOperational: true });
  });

  it('denies everyone when no roles are allowed', () => {
    const { error } = run(authorize(), buildRequest({ id: 'user-1', role: Role.OWNER }));

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  describe('unknown roles', () => {
    it.each([['ADMN'], ['admin'], [''], [undefined], [null]])(
      'throws when registered with %j',
      (role) => {
        expect(() => authorize(Role.ADMIN, role)).toThrow(/authorize: unknown role/);
      },
    );
  });

  describe('authorization failure log', () => {
    it('logs role, method, url without query, ip, client type and timestamp on a 403', () => {
      run(adminOrOwner, buildRequest({ id: 'user-1', role: Role.MEMBER }));

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [fields, message] = logger.warn.mock.calls[0];
      expect(fields).toEqual({
        userId: 'user-1',
        role: Role.MEMBER,
        method: 'POST',
        url: '/api/v1/admin/staff',
        ipAddress: '203.0.113.9',
        clientType: 'mobile',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
      });
      expect(message).toBe(Messages.AUTHORIZATION_DENIED);
    });

    it('never logs the token or the query string', () => {
      run(adminOrOwner, buildRequest({ id: 'user-1', role: Role.MEMBER }));

      expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/secret/);
    });

    it('logs nothing when the role is allowed', () => {
      run(adminOrOwner, buildRequest({ id: 'user-1', role: Role.ADMIN }));

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs nothing on a 401 (no authenticated user)', () => {
      run(adminOrOwner, buildRequest(undefined));

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
