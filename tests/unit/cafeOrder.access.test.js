const { Role } = require('../../src/constants/roles');
const { buildOrderScope, isOrderAdmin } = require('../../src/services/cafeOrder.access');

describe('cafeOrder.access', () => {
  it.each([Role.ADMIN, Role.OWNER])('%s is an order admin with an unrestricted scope', (role) => {
    const user = { id: 'u1', role };
    expect(isOrderAdmin(user)).toBe(true);
    expect(buildOrderScope(user)).toEqual({});
  });

  it.each([Role.COACH, Role.MEMBER])('%s is scoped to orders they created', (role) => {
    const user = { id: 'u2', role };
    expect(isOrderAdmin(user)).toBe(false);
    expect(buildOrderScope(user)).toEqual({ createdById: 'u2' });
  });

  it('treats an unknown role as non-admin', () => {
    expect(buildOrderScope({ id: 'u3', role: 'SUPERUSER' })).toEqual({ createdById: 'u3' });
  });

  it.each([undefined, null, {}, { role: Role.ADMIN }])(
    'throws without an authenticated user id (%o)',
    (user) => {
      expect(() => buildOrderScope(user)).toThrow(/authenticated user required/);
    },
  );
});
