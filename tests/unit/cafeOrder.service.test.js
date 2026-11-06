jest.mock('../../src/repositories/cafeOrder.repository');

const repo = require('../../src/repositories/cafeOrder.repository');
const { Role } = require('../../src/constants/roles');
const { AppErrors } = require('../../src/constants/errors');
const {
  toCreatedAtRange,
  listOrders,
  getOrder,
  getSummary,
} = require('../../src/services/cafeOrder.service');

const coach = { id: 'coach-1', role: Role.COACH };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('cafeOrder.service', () => {
  describe('toCreatedAtRange (Asia/Dubai, UTC+4)', () => {
    it('returns undefined without bounds', () => {
      expect(toCreatedAtRange({}, 'Asia/Dubai')).toBeUndefined();
    });

    it('maps inclusive local days to a UTC [gte, lt) range', () => {
      expect(toCreatedAtRange({ from: '2026-11-06', to: '2026-11-06' }, 'Asia/Dubai')).toEqual({
        gte: new Date('2026-11-05T20:00:00.000Z'),
        lt: new Date('2026-11-06T20:00:00.000Z'),
      });
    });

    it('supports open-ended ranges and month ends', () => {
      expect(toCreatedAtRange({ to: '2026-12-31' }, 'Asia/Dubai')).toEqual({
        lt: new Date('2026-12-31T20:00:00.000Z'),
      });
      expect(toCreatedAtRange({ from: '2026-03-01' }, 'Asia/Dubai')).toEqual({
        gte: new Date('2026-02-28T20:00:00.000Z'),
      });
    });
  });

  describe('scope is derived from the user, never from the query', () => {
    beforeEach(() => {
      repo.listOrders.mockResolvedValue([]);
      repo.countOrders.mockResolvedValue(0);
      repo.getOrderSummary.mockResolvedValue({ orderCount: 0, preparingCount: 0, itemSales: [] });
      repo.findOrderById.mockResolvedValue(null);
    });

    it('list passes the creator scope for staff and maps status to the DB enum', async () => {
      await listOrders({ user: coach, query: { status: 'ready', page: 2, limit: 10 } });
      expect(repo.listOrders).toHaveBeenCalledWith(
        { createdById: 'coach-1' },
        expect.objectContaining({ status: 'READY', skip: 10, take: 10 }),
      );
      expect(repo.countOrders).toHaveBeenCalledWith(
        { createdById: 'coach-1' },
        expect.objectContaining({ status: 'READY' }),
      );
    });

    it('list passes an empty scope for admins', async () => {
      await listOrders({ user: admin, query: { page: 1, limit: 20 } });
      expect(repo.listOrders.mock.calls[0][0]).toEqual({});
    });

    it('detail throws ORDER_NOT_FOUND when nothing is in scope', async () => {
      await expect(getOrder({ user: coach, orderId: 'o1' })).rejects.toMatchObject({
        code: AppErrors.ORDER_NOT_FOUND.code,
        statusCode: 404,
      });
      expect(repo.findOrderById).toHaveBeenCalledWith({ createdById: 'coach-1' }, 'o1');
    });

    it('summary uses the same scope and picks the first ranked item as top seller', async () => {
      repo.getOrderSummary.mockResolvedValue({
        orderCount: 3,
        preparingCount: 1,
        itemSales: [
          { itemName: 'Latte', quantity: 4 },
          { itemName: 'Mocha', quantity: 1 },
        ],
      });
      const result = await getSummary({
        user: coach,
        query: { from: '2026-11-01', to: '2026-11-02' },
      });

      expect(repo.getOrderSummary).toHaveBeenCalledWith(
        { createdById: 'coach-1' },
        { createdAt: toCreatedAtRange({ from: '2026-11-01', to: '2026-11-02' }, 'Asia/Dubai') },
      );
      expect(result).toEqual({
        range: { from: '2026-11-01', to: '2026-11-02', timezone: 'Asia/Dubai' },
        orderCount: 3,
        preparingCount: 1,
        topSeller: { itemName: 'Latte', quantity: 4 },
        itemSalesHistory: [
          { itemName: 'Latte', quantity: 4 },
          { itemName: 'Mocha', quantity: 1 },
        ],
      });
    });

    it('summary returns a null top seller when nothing sold', async () => {
      const result = await getSummary({
        user: admin,
        query: { from: '2026-11-01', to: '2026-11-01' },
      });
      expect(result.topSeller).toBeNull();
    });
  });
});
