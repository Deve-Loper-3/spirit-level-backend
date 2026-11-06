const {
  isCalendarDate,
  listOrdersQuerySchema,
  orderSummaryQuerySchema,
  orderIdParamSchema,
  orderDetailQuerySchema,
} = require('../../src/validators/cafeOrder.validation');

describe('cafeOrder.validation', () => {
  describe('isCalendarDate', () => {
    it.each(['2026-11-06', '2024-02-29', '2000-01-01'])('accepts %s', (d) => {
      expect(isCalendarDate(d)).toBe(true);
    });

    it.each([
      '2026-02-29',
      '2026-13-01',
      '2026-04-31',
      '2026-1-1',
      '06/11/2026',
      '2026-11-06T00:00',
    ])('rejects %s', (d) => {
      expect(isCalendarDate(d)).toBe(false);
    });
  });

  describe('listOrdersQuerySchema', () => {
    it('applies defaults', () => {
      expect(listOrdersQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    });

    it('coerces page and limit and trims search', () => {
      expect(listOrdersQuerySchema.parse({ page: '3', limit: '100', search: '  latte ' })).toEqual({
        page: 3,
        limit: 100,
        search: 'latte',
      });
    });

    it.each([
      { limit: '101' },
      { limit: '0' },
      { limit: '1.5' },
      { page: '0' },
      { status: 'cancelled' },
      { status: ['ready', 'served'] },
      { search: ['a', 'b'] },
      { search: 'x'.repeat(101) },
      { from: '2026-11-07', to: '2026-11-06' },
      { source: 'pos' },
      { userId: 'abc' },
    ])('rejects %o', (query) => {
      expect(listOrdersQuerySchema.safeParse(query).success).toBe(false);
    });

    it('accepts a same-day range', () => {
      expect(
        listOrdersQuerySchema.safeParse({ from: '2026-11-06', to: '2026-11-06' }).success,
      ).toBe(true);
    });
  });

  describe('orderSummaryQuerySchema', () => {
    it('accepts an empty query and only from/to', () => {
      expect(orderSummaryQuerySchema.parse({})).toEqual({});
      expect(orderSummaryQuerySchema.safeParse({ page: '1' }).success).toBe(false);
      expect(orderSummaryQuerySchema.safeParse({ status: 'ready' }).success).toBe(false);
    });
  });

  describe('orderDetailQuerySchema', () => {
    it('accepts no query parameters and rejects any', () => {
      expect(orderDetailQuerySchema.parse({})).toEqual({});
      expect(orderDetailQuerySchema.safeParse({ userId: 'x' }).success).toBe(false);
      expect(orderDetailQuerySchema.safeParse({ include: 'items' }).success).toBe(false);
    });
  });

  describe('orderIdParamSchema', () => {
    it('requires a UUID', () => {
      expect(orderIdParamSchema.safeParse({ orderId: 'abc' }).success).toBe(false);
      expect(
        orderIdParamSchema.safeParse({ orderId: '3f1c2b9e-8a4d-4f6b-9c2e-1a2b3c4d5e6f' }).success,
      ).toBe(true);
    });
  });
});
