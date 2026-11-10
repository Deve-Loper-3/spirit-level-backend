const prisma = require('../../src/config/prisma');
const {
  listTrackedItems,
  countTrackedItems,
  getSummaryItems,
  updateStock,
} = require('../../src/repositories/cafeInventory.repository');

jest.mock('../../src/config/prisma', () => ({
  cafeItem: { findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
}));

describe('Cafe inventory repository', () => {
  beforeEach(() => jest.resetAllMocks());

  it('selects tracked inventory rows with category and stable name/id ordering', async () => {
    prisma.cafeItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

    expect(await listTrackedItems()).toEqual([{ id: 'item-1' }]);
    expect(prisma.cafeItem.findMany).toHaveBeenCalledWith({
      where: { isTracked: true },
      skip: 0,
      take: undefined,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        stockQuantity: true,
        unitCost: true,
        availability: true,
      },
    });
  });

  it('applies category, escaped search, status and pagination in the DB, with matching count filters', async () => {
    const filters = { categoryId: 'category-1', search: '  a%b_c\\d  ', status: 'LOW_STOCK' };
    prisma.cafeItem.count.mockResolvedValue(3);

    await listTrackedItems({ ...filters, skip: 10, take: 5 });
    expect(await countTrackedItems(filters)).toBe(3);

    const where = {
      isTracked: true,
      stockQuantity: { gt: 0, lt: 15 },
      categoryId: 'category-1',
      OR: [
        { name: { contains: 'a\\%b\\_c\\\\d', mode: 'insensitive' } },
        { description: { contains: 'a\\%b\\_c\\\\d', mode: 'insensitive' } },
      ],
    };
    expect(prisma.cafeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 5 }),
    );
    expect(prisma.cafeItem.count).toHaveBeenCalledWith({ where });
  });

  it('ignores blank search and does not accept visibility or isTracked overrides', async () => {
    await listTrackedItems({ search: '   ', isTracked: false, visibility: 'PUBLIC' });
    await countTrackedItems();

    expect(prisma.cafeItem.findMany.mock.calls[0][0].where).toEqual({ isTracked: true });
    expect(prisma.cafeItem.count).toHaveBeenCalledWith({ where: { isTracked: true } });
  });

  it('loads all tracked summary inputs, selecting only quantity and cost', async () => {
    const rows = [{ stockQuantity: 14, unitCost: '1.25' }];
    prisma.cafeItem.findMany.mockResolvedValue(rows);

    expect(await getSummaryItems()).toBe(rows);
    expect(prisma.cafeItem.findMany).toHaveBeenCalledWith({
      where: { isTracked: true },
      select: { stockQuantity: true, unitCost: true },
    });
  });

  it('reuses the item write to persist quantity and availability together by id', async () => {
    const data = { stockQuantity: 0, availability: 'SOLD_OUT' };
    const saved = { id: 'item-1', ...data };
    prisma.cafeItem.update.mockResolvedValue(saved);

    expect(await updateStock('item-1', data)).toBe(saved);
    expect(prisma.cafeItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.cafeItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data,
      include: { category: true },
    });
  });

  it('supports an existing transaction client for each repository operation', async () => {
    const client = {
      cafeItem: { findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    };

    await listTrackedItems({ take: 5 }, client);
    await countTrackedItems({}, client);
    await getSummaryItems(client);
    await updateStock('item-1', { stockQuantity: 15 }, client);

    expect(client.cafeItem.findMany).toHaveBeenCalledTimes(2);
    expect(client.cafeItem.count).toHaveBeenCalledTimes(1);
    expect(client.cafeItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.cafeItem.findMany).not.toHaveBeenCalled();
    expect(prisma.cafeItem.count).not.toHaveBeenCalled();
    expect(prisma.cafeItem.update).not.toHaveBeenCalled();
  });
});
