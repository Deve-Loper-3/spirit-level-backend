const { Prisma } = require('@prisma/client');
const {
  toCafeItemResponse,
  toCafeInventoryItemResponse,
  toCafeStockUpdateResponse,
} = require('../../src/repositories/cafe.mapper');

describe('Cafe Mapper (toCafeItemResponse)', () => {
  it('converts uppercase DB enums to lowercase API values and Decimals to numbers', () => {
    const dbItem = {
      id: 'item-uuid-1',
      name: 'Vanilla Protein Shake',
      categoryId: 'cat-uuid-1',
      category: {
        id: 'cat-uuid-1',
        name: 'Protein Shakes',
        description: 'High protein shakes',
      },
      description: 'Delicious shake',
      nutrition: { calories: 250, protein: 30, carbs: 10, fat: 4 },
      priceAed: new Prisma.Decimal('28.50'),
      imageUrl: 'https://example.com/shake.png',
      availability: 'AVAILABLE',
      visibility: 'PUBLIC',
      isTracked: true,
      stockQuantity: 15,
      unitCost: new Prisma.Decimal('12.00'),
      createdAt: new Date('2026-11-01T10:00:00Z'),
      updatedAt: new Date('2026-11-01T10:00:00Z'),
    };

    const mapped = toCafeItemResponse(dbItem);

    expect(mapped.id).toBe('item-uuid-1');
    expect(mapped.name).toBe('Vanilla Protein Shake');
    expect(mapped.availability).toBe('available');
    expect(mapped.visibility).toBe('public');
    expect(mapped.priceAed).toBe(28.5);
    expect(typeof mapped.priceAed).toBe('number');
    expect(mapped.unitCost).toBe(12);
    expect(typeof mapped.unitCost).toBe('number');
    expect(mapped.category).toEqual({
      id: 'cat-uuid-1',
      name: 'Protein Shakes',
      description: 'High protein shakes',
    });
  });

  it('converts SOLD_OUT and STAFF_ONLY to lowercase', () => {
    const dbItem = {
      id: 'item-uuid-2',
      name: 'Energy Gel',
      categoryId: 'cat-uuid-2',
      category: null,
      description: null,
      nutrition: null,
      priceAed: 15.0,
      imageUrl: null,
      availability: 'SOLD_OUT',
      visibility: 'STAFF_ONLY',
      isTracked: true,
      stockQuantity: 0,
      unitCost: 8.0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mapped = toCafeItemResponse(dbItem);

    expect(mapped.availability).toBe('sold_out');
    expect(mapped.visibility).toBe('staff_only');
    expect(mapped.category).toBeUndefined();
    expect(mapped.stockQuantity).toBe(0);
    expect(mapped.unitCost).toBe(8);
  });

  it('handles untracked items where stockQuantity and unitCost are null', () => {
    const dbItem = {
      id: 'item-uuid-3',
      name: 'Espresso',
      categoryId: 'cat-uuid-3',
      category: null,
      description: null,
      nutrition: null,
      priceAed: 18.0,
      imageUrl: null,
      availability: 'AVAILABLE',
      visibility: 'PUBLIC',
      isTracked: false,
      stockQuantity: null,
      unitCost: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mapped = toCafeItemResponse(dbItem);

    expect(mapped.isTracked).toBe(false);
    expect(mapped.stockQuantity).toBeNull();
    expect(mapped.unitCost).toBeNull();
  });

  it('returns null if input item is null or undefined', () => {
    expect(toCafeItemResponse(null)).toBeNull();
    expect(toCafeItemResponse(undefined)).toBeNull();
  });
});

describe('Cafe inventory mappers', () => {
  const item = {
    id: 'inventory-1',
    name: 'Protein Bar',
    categoryId: 'category-1',
    category: { id: 'category-1', name: 'Snacks', description: 'Internal description' },
    isTracked: true,
    stockQuantity: 15,
    unitCost: new Prisma.Decimal('1.25'),
    availability: 'AVAILABLE',
    visibility: 'STAFF_ONLY',
    externalRef: 'private-ref',
    priceAed: new Prisma.Decimal('3.50'),
    updatedAt: new Date('2026-11-03T00:00:00Z'),
  };

  it('maps only inventory fields with numeric cost and the service-derived status', () => {
    expect(toCafeInventoryItemResponse(item, 'IN_STOCK')).toEqual({
      id: 'inventory-1',
      name: 'Protein Bar',
      categoryId: 'category-1',
      category: { id: 'category-1', name: 'Snacks' },
      quantity: 15,
      unitCost: 1.25,
      stockStatus: 'IN_STOCK',
    });
    expect(item.unitCost).toBeInstanceOf(Prisma.Decimal);
    expect(item.stockQuantity).toBe(15);
  });

  it.each([new Prisma.Decimal('0.00'), 0, '0.00'])(
    'maps zero cost %s to null without changing catalogue mapping',
    (unitCost) => {
      const row = { ...item, unitCost };

      expect(toCafeInventoryItemResponse(row, 'IN_STOCK').unitCost).toBeNull();
      expect(toCafeStockUpdateResponse(row, 'IN_STOCK').unitCost).toBeNull();
      expect(toCafeItemResponse(row).unitCost).toBe(0);
      expect(row.unitCost).toBe(unitCost);
    },
  );

  it.each([null, undefined])('preserves an absent cost (%s) as null', (unitCost) => {
    expect(toCafeInventoryItemResponse({ ...item, unitCost }, 'IN_STOCK').unitCost).toBeNull();
  });

  it.each([
    ['AVAILABLE', 'available'],
    ['SOLD_OUT', 'sold_out'],
  ])('maps persisted availability %s in stock update responses', (availability, expected) => {
    const row = { ...item, stockQuantity: 0, availability };

    expect(toCafeStockUpdateResponse(row, 'OUT_OF_STOCK')).toEqual({
      ...toCafeInventoryItemResponse(row, 'OUT_OF_STOCK'),
      quantity: 0,
      availability: expected,
      updatedAt: item.updatedAt,
    });
  });

  it.each([null, undefined])('returns null for absent inventory/stock records (%s)', (row) => {
    expect(toCafeInventoryItemResponse(row, 'IN_STOCK')).toBeNull();
    expect(toCafeStockUpdateResponse(row, 'IN_STOCK')).toBeNull();
  });

  it('omits category when the relation was not loaded', () => {
    expect(
      toCafeInventoryItemResponse({ ...item, category: undefined }, 'IN_STOCK').category,
    ).toBeUndefined();
  });
});
