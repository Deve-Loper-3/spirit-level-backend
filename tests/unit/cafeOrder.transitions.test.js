jest.mock('../../src/repositories/cafeOrder.repository');
jest.mock('../../src/repositories/user.repository', () => ({
  findAuthWithEmailById: jest.fn(),
}));

const repo = require('../../src/repositories/cafeOrder.repository');
const userRepository = require('../../src/repositories/user.repository');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const { AuditAction } = require('../../src/constants/audit');
const { ORDER_STATUS_TRANSITIONS } = require('../../src/constants/cafeOrder');
const {
  getAllowedTransitions,
  isAllowedTransition,
  updateOrderStatus,
} = require('../../src/services/cafeOrder.service');

const STATUSES = ['preparing', 'ready', 'served'];
const admin = { id: 'admin-1', role: Role.ADMIN };
const ORDER_ID = '3f1c2b9e-8a4d-4f6b-9c2e-1a2b3c4d5e6f';

describe('cafe order status transitions', () => {
  beforeEach(() => {
    userRepository.findAuthWithEmailById.mockResolvedValue({
      id: admin.id,
      email: 'admin@test.invalid',
      role: Role.ADMIN,
      status: 'ACTIVE',
    });
  });

  describe('transition map', () => {
    it('is exactly preparing -> ready -> served, with nothing after served', () => {
      expect(ORDER_STATUS_TRANSITIONS).toEqual({
        preparing: 'ready',
        ready: 'served',
        served: null,
      });
      expect(Object.isFrozen(ORDER_STATUS_TRANSITIONS)).toBe(true);
    });

    it.each([
      ['preparing', ['ready']],
      ['ready', ['served']],
      ['served', []],
    ])('allows %s -> %j', (from, allowed) => {
      expect(getAllowedTransitions(from)).toEqual(allowed);
    });

    const allowedPairs = new Set(['preparing>ready', 'ready>served']);
    const allPairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to]));

    it.each(allPairs)('%s -> %s', (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(allowedPairs.has(`${from}>${to}`));
    });

    it.each(['cancelled', 'paid', 'PREPARING', undefined])('rejects unknown status %s', (s) => {
      expect(getAllowedTransitions(s)).toEqual([]);
      expect(isAllowedTransition('preparing', s)).toBe(false);
    });
  });

  describe('updateOrderStatus (repository mocked)', () => {
    const order = { id: ORDER_ID, orderNumber: 'CO-1', status: 'PREPARING' };

    it('rejects a non-admin actor even if the route check were bypassed', async () => {
      await expect(
        updateOrderStatus({
          actor: { id: 'c', role: Role.COACH },
          orderId: ORDER_ID,
          status: 'ready',
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: AppErrors.FORBIDDEN.code });
      expect(repo.findOrderStatusById).not.toHaveBeenCalled();
    });

    it('404 when the order does not exist', async () => {
      repo.findOrderStatusById.mockResolvedValue(null);
      await expect(
        updateOrderStatus({ actor: admin, orderId: ORDER_ID, status: 'ready' }),
      ).rejects.toMatchObject({ statusCode: 404, code: AppErrors.ORDER_NOT_FOUND.code });
    });

    it('409 with { from, to, allowed } and no write for a skipped step', async () => {
      repo.findOrderStatusById.mockResolvedValue(order);
      await expect(
        updateOrderStatus({ actor: admin, orderId: ORDER_ID, status: 'served' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.INVALID_ORDER_STATUS_TRANSITION.code,
        details: { from: 'preparing', to: 'served', allowed: ['ready'] },
      });
      expect(repo.updateOrderStatusWithAudit).not.toHaveBeenCalled();
    });

    it('writes with the DB statuses the caller saw and an audit payload', async () => {
      repo.findOrderStatusById.mockResolvedValue(order);
      repo.updateOrderStatusWithAudit.mockResolvedValue({
        id: ORDER_ID,
        orderNumber: 'CO-1',
        status: 'READY',
        customerName: null,
        totalAed: 10,
        paymentStatus: 'NOT_TRACKED',
        createdBy: { id: 'u', fullName: 'U' },
        _count: { items: 0 },
        items: [],
      });

      const result = await updateOrderStatus({
        actor: admin,
        orderId: ORDER_ID,
        status: 'ready',
        meta: { ipAddress: '1.2.3.4' },
      });

      expect(userRepository.findAuthWithEmailById).toHaveBeenCalledWith('admin-1');
      expect(repo.updateOrderStatusWithAudit).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        from: 'PREPARING',
        to: 'READY',
        audit: {
          action: AuditAction.CAFE_ORDER_STATUS_CHANGED,
          userId: null,
          actorId: 'admin-1',
          actorRole: Role.ADMIN,
          email: 'admin@test.invalid',
          reason: `CO-1 (${ORDER_ID})`,
          details: { orderId: ORDER_ID, orderNumber: 'CO-1', from: 'preparing', to: 'ready' },
          meta: { ipAddress: '1.2.3.4' },
        },
      });
      expect(result).toMatchObject({ status: 'ready', paymentStatus: 'not_tracked' });
    });

    it('lost race, status changed meanwhile: 409 from the current status', async () => {
      repo.findOrderStatusById
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: 'READY' });
      repo.updateOrderStatusWithAudit.mockResolvedValue(null);

      await expect(
        updateOrderStatus({ actor: admin, orderId: ORDER_ID, status: 'ready' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { from: 'ready', to: 'ready', allowed: ['served'] },
      });
    });

    it('lost race, order deleted meanwhile: 404', async () => {
      repo.findOrderStatusById.mockResolvedValueOnce(order).mockResolvedValueOnce(null);
      repo.updateOrderStatusWithAudit.mockResolvedValue(null);

      await expect(
        updateOrderStatus({ actor: admin, orderId: ORDER_ID, status: 'ready' }),
      ).rejects.toMatchObject({ statusCode: 404, code: AppErrors.ORDER_NOT_FOUND.code });
    });
  });
});
