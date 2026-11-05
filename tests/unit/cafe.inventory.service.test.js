const { Prisma } = require('@prisma/client');
const { findById } = require('../../src/repositories/cafeItem.repository');
const repository = require('../../src/repositories/cafeInventory.repository');
const {
  deriveStockStatus,
  updateStock,
  listInventory,
  getSummary,
} = require('../../src/services/cafeInventory.service');

jest.mock('../../src/repositories/cafeItem.repository', () => ({ findById: jest.fn() }));
jest.mock('../../src/repositories/cafeInventory.repository', () => ({
  listTrackedItems: jest.fn(),
  countTrackedItems: jest.fn(),
  getSummaryItems: jest.fn(),
  updateStock: jest.fn(),
}));

const itemRow = (overrides = {}) => ({
  id: 'item-1',
  name: 'Protein Bar',
  categoryId: 'category-1',
  category: { id: 'category-1', name: 'Snacks' },
  isTracked: true,
  stockQuantity: 15,
  unitCost: new Prisma.Decimal('1.25'),
  availability: 'AVAILABLE',
  visibility: 'STAFF_ONLY',
  updatedAt: new Date('2026-11-03T00:00:00Z'),
  ...overrides,
});

describe('Cafe inventory service', () => {
  beforeEach(() => jest.resetAllMocks());

  describe('deriveStockStatus', () => {
    it.each([
      [0, 'OUT_OF_STOCK'],
      [1, 'LOW_STOCK'],
      [14, 'LOW_STOCK'],
      [15, 'IN_STOCK'],
      [16, 'IN_STOCK'],
    ])('classifies quantity %i as %s', (quantity, expected) => {
      expect(deriveStockStatus(quantity)).toBe(expected);
    });
  });

  describe('updateStock', () => {
    it('sets zero stock and SOLD_OUT in a single write and maps the persisted result', async () => {
      findById.mockResolvedValue(itemRow());
      repository.updateStock.mockResolvedValue(
        itemRow({ stockQuantity: 0, availability: 'SOLD_OUT', unitCost: new Prisma.Decimal(0) }),
      );

      const result = await updateStock({
        itemId: 'item-1',
        payload: { quantity: 0, unitCost: 100, availability: 'available', delta: -1 },
      });

      expect(findById).toHaveBeenCalledWith('item-1');
      expect(repository.updateStock).toHaveBeenCalledTimes(1);
      expect(repository.updateStock).toHaveBeenCalledWith('item-1', {
        stockQuantity: 0,
        availability: 'SOLD_OUT',
      });
      expect(result).toMatchObject({
        id: 'item-1',
        quantity: 0,
        stockStatus: 'OUT_OF_STOCK',
        availability: 'sold_out',
        unitCost: null,
      });
    });

    it.each(['SOLD_OUT', 'AVAILABLE'])(
      'replaces stock without writing the existing %s availability',
      async (availability) => {
        findById.mockResolvedValue(
          itemRow({ stockQuantity: availability === 'SOLD_OUT' ? 0 : 16, availability }),
        );
        repository.updateStock.mockResolvedValue(itemRow({ stockQuantity: 15, availability }));

        const result = await updateStock({ itemId: 'item-1', payload: { quantity: 15 } });

        expect(repository.updateStock).toHaveBeenCalledTimes(1);
        expect(repository.updateStock).toHaveBeenCalledWith('item-1', { stockQuantity: 15 });
        expect(result).toMatchObject({ quantity: 15, stockStatus: 'IN_STOCK' });
        expect(result.availability).toBe(availability.toLowerCase());
      },
    );

    it('returns 404 ITEM_NOT_FOUND before any write for an unknown item', async () => {
      findById.mockResolvedValue(null);

      await expect(
        updateStock({ itemId: 'missing', payload: { quantity: 1 } }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'ITEM_NOT_FOUND',
      });
      expect(repository.updateStock).not.toHaveBeenCalled();
    });

    it('returns 409 ITEM_NOT_TRACKED without updating made-to-order items', async () => {
      findById.mockResolvedValue(
        itemRow({ isTracked: false, stockQuantity: null, unitCost: null }),
      );

      await expect(
        updateStock({ itemId: 'item-1', payload: { quantity: 0 } }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ITEM_NOT_TRACKED',
      });
      expect(repository.updateStock).not.toHaveBeenCalled();
    });

    it('maps deletion between lookup and write to 404 ITEM_NOT_FOUND', async () => {
      findById.mockResolvedValue(itemRow());
      repository.updateStock.mockRejectedValue({ code: 'P2025' });

      await expect(
        updateStock({ itemId: 'item-1', payload: { quantity: 1 } }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'ITEM_NOT_FOUND',
      });
    });

    it('propagates other write failures', async () => {
      const error = new Error('Write failed');
      findById.mockResolvedValue(itemRow());
      repository.updateStock.mockRejectedValue(error);

      await expect(updateStock({ itemId: 'item-1', payload: { quantity: 1 } })).rejects.toBe(error);
    });
  });

  describe('listInventory', () => {
    beforeEach(() => {
      repository.listTrackedItems.mockResolvedValue([]);
      repository.countTrackedItems.mockResolvedValue(0);
    });

    it('returns the default DB page, mapping staff-only and zero-cost inventory', async () => {
      repository.listTrackedItems.mockResolvedValue([itemRow({ unitCost: new Prisma.Decimal(0) })]);
      repository.countTrackedItems.mockResolvedValue(1);

      const result = await listInventory();

      expect(repository.listTrackedItems).toHaveBeenCalledWith({
        categoryId: undefined,
        search: undefined,
        skip: 0,
        take: 20,
      });
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'item-1',
          quantity: 15,
          unitCost: null,
          stockStatus: 'IN_STOCK',
        }),
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('passes category/search and page bounds to the repository and reuses count filters', async () => {
      await listInventory({
        query: { categoryId: 'category-1', search: 'Gel', page: 3, limit: 5 },
      });

      expect(repository.listTrackedItems).toHaveBeenCalledWith({
        categoryId: 'category-1',
        search: 'Gel',
        skip: 10,
        take: 5,
      });
      expect(repository.countTrackedItems).toHaveBeenCalledWith({
        categoryId: 'category-1',
        search: 'Gel',
      });
    });

    it.each([
      ['OUT_OF_STOCK', [0]],
      ['LOW_STOCK', [1, 14]],
      ['IN_STOCK', [15, 16]],
    ])('filters %s from the full candidate set in the service', async (status, quantities) => {
      repository.listTrackedItems.mockResolvedValue(
        [0, 1, 14, 15, 16].map((stockQuantity) => itemRow({ stockQuantity })),
      );

      const result = await listInventory({ query: { status, categoryId: 'category-1' } });

      expect(repository.listTrackedItems).toHaveBeenCalledWith({
        categoryId: 'category-1',
        search: undefined,
      });
      expect(repository.countTrackedItems).not.toHaveBeenCalled();
      expect(result.data.map((item) => item.quantity)).toEqual(quantities);
      expect(result.pagination.total).toBe(quantities.length);
    });

    it('filters status before slicing a page and computes the matching total', async () => {
      repository.listTrackedItems.mockResolvedValue(
        [0, 1, 15, 14, 16].map((stockQuantity) => itemRow({ stockQuantity })),
      );

      const result = await listInventory({ query: { status: 'LOW_STOCK', page: 2, limit: 1 } });

      expect(result.data.map((item) => item.quantity)).toEqual([14]);
      expect(result.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    });

    it('returns a zero-total empty page when no derived status matches', async () => {
      repository.listTrackedItems.mockResolvedValue([itemRow({ stockQuantity: 0 })]);

      expect(await listInventory({ query: { status: 'LOW_STOCK' } })).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('keeps the matching total on a status-filtered page past the end', async () => {
      repository.listTrackedItems.mockResolvedValue([itemRow({ stockQuantity: 1 })]);

      expect(await listInventory({ query: { status: 'LOW_STOCK', page: 2, limit: 1 } })).toEqual({
        data: [],
        pagination: { page: 2, limit: 1, total: 1, totalPages: 1 },
      });
    });

    it('returns the existing empty pagination envelope when no tracked rows exist', async () => {
      expect(await listInventory()).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('propagates inventory read failures', async () => {
      const error = new Error('Read failed');
      repository.listTrackedItems.mockRejectedValue(error);

      await expect(listInventory()).rejects.toBe(error);
    });
  });

  describe('getSummary', () => {
    it('counts all tracked boundary quantities, zero costs and zero-stock items', async () => {
      repository.getSummaryItems.mockResolvedValue([
        { stockQuantity: 0, unitCost: new Prisma.Decimal('9.99') },
        { stockQuantity: 1, unitCost: new Prisma.Decimal('0.00') },
        { stockQuantity: 14, unitCost: new Prisma.Decimal('0.10') },
        { stockQuantity: 15, unitCost: new Prisma.Decimal('1.25') },
        { stockQuantity: 16, unitCost: new Prisma.Decimal('0.00') },
      ]);

      expect(await getSummary()).toEqual({
        trackedItems: 5,
        lowStock: 3,
        outOfStock: 1,
        stockValueAed: 20.15,
        itemsMissingCost: 2,
        itemsSold: null,
        revenueFromItemsAed: null,
        bestSeller: null,
        salesDataAvailable: false,
      });
      expect(repository.getSummaryItems).toHaveBeenCalledWith();
    });

    it('accumulates decimal costs in integer minor units instead of floats', async () => {
      repository.getSummaryItems.mockResolvedValue([
        { stockQuantity: 1, unitCost: new Prisma.Decimal('0.10') },
        { stockQuantity: 1, unitCost: new Prisma.Decimal('0.20') },
        { stockQuantity: 3, unitCost: new Prisma.Decimal('0.01') },
        { stockQuantity: 7, unitCost: new Prisma.Decimal('0.29') },
      ]);

      const result = await getSummary();

      expect(result.stockValueAed).toBe(2.36);
      expect(result.itemsMissingCost).toBe(0);
    });

    it('excludes placeholder costs from value and counts them even at zero stock', async () => {
      repository.getSummaryItems.mockResolvedValue([
        { stockQuantity: 0, unitCost: new Prisma.Decimal('0.00') },
        { stockQuantity: 100, unitCost: new Prisma.Decimal('0.00') },
      ]);

      expect(await getSummary()).toMatchObject({
        trackedItems: 2,
        lowStock: 1,
        outOfStock: 1,
        stockValueAed: 0,
        itemsMissingCost: 2,
      });
    });

    it('returns zero inventory cards and null sales cards for empty tracked data', async () => {
      repository.getSummaryItems.mockResolvedValue([]);

      expect(await getSummary()).toEqual({
        trackedItems: 0,
        lowStock: 0,
        outOfStock: 0,
        stockValueAed: 0,
        itemsMissingCost: 0,
        itemsSold: null,
        revenueFromItemsAed: null,
        bestSeller: null,
        salesDataAvailable: false,
      });
    });

    it('propagates summary read failures', async () => {
      const error = new Error('Summary unavailable');
      repository.getSummaryItems.mockRejectedValue(error);

      await expect(getSummary()).rejects.toBe(error);
    });
  });
});
