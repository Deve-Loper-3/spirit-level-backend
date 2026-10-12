jest.mock('../../src/config/logger', () => ({
  warn: jest.fn(),
}));

const logger = require('../../src/config/logger');
const { authorize } = require('../../src/middlewares/authorize.middleware');
const { Role } = require('../../src/constants/roles');

const run = (middleware, req) => {
  const next = jest.fn();
  middleware(req, {}, next);
  return { next, error: next.mock.calls[0]?.[0] };
};

describe('authorize middleware', () => {
  const adminOrOwner = authorize(Role.ADMIN, Role.OWNER);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next without an error when the role is allowed and does not log', () => {
    const { next, error } = run(adminOrOwner, {
      user: { id: 'admin-1', role: Role.ADMIN },
      method: 'GET',
      originalUrl: '/test',
      ip: '127.0.0.1',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('allows every listed role and does not log', () => {
    const { next, error } = run(adminOrOwner, {
      user: { id: 'owner-1', role: Role.OWNER },
      method: 'GET',
      originalUrl: '/test',
      ip: '127.0.0.1',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([Role.COACH, Role.MEMBER])(
    'returns 403 FORBIDDEN for %s and logs structured warning with user, endpoint and ip',
    (role) => {
      const req = {
        user: { id: 'user-123', role },
        method: 'POST',
        originalUrl: '/api/v1/admin/staff',
        ip: '192.168.1.1',
      };
      const { error } = run(adminOrOwner, req);

      expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', isOperational: true });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          role,
          method: 'POST',
          endpoint: '/api/v1/admin/staff',
          ip: '192.168.1.1',
          timestamp: expect.any(String),
        },
        'Authorization failure: unauthorized role access',
      );
    },
  );

  it('uses req.url as endpoint when req.originalUrl is absent on 403', () => {
    const req = {
      user: { id: 'user-456', role: Role.MEMBER },
      method: 'GET',
      url: '/test-fallback',
      ip: '10.0.0.1',
    };
    const { error } = run(adminOrOwner, req);

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', isOperational: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/test-fallback',
      }),
      expect.any(String),
    );
  });

  it('returns 401 UNAUTHORIZED when req.user is missing and does not log', () => {
    const { error } = run(adminOrOwner, {
      method: 'GET',
      originalUrl: '/test',
      ip: '127.0.0.1',
    });

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', isOperational: true });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('denies everyone when no roles are allowed and logs warning', () => {
    const req = {
      user: { id: 'owner-2', role: Role.OWNER },
      method: 'GET',
      originalUrl: '/locked',
      ip: '127.0.0.1',
    };
    const { error } = run(authorize(), req);

    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
