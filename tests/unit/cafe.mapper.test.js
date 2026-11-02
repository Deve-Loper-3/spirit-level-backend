const { Prisma } = require('@prisma/client');
const { toCafeItemResponse } = require('../../src/repositories/cafe.mapper');

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
