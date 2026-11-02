const prisma = require('../../src/config/prisma');
const { runSeed, deriveItemName, normalizeWhitespace } = require('../../prisma/seeds/cafe.seed');

jest.setTimeout(60000);

describe('Cafe Seed (Dry Run & Parser)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('normalizeWhitespace', () => {
    it('collapses internal spaces and trims string', () => {
      expect(
        normalizeWhitespace('Merch -  Womens SL x PUMA Cloud-spun sleeveless Training Tank'),
      ).toBe('Merch - Womens SL x PUMA Cloud-spun sleeveless Training Tank');
      expect(normalizeWhitespace('   Supplements   ')).toBe('Supplements');
      expect(normalizeWhitespace('')).toBeNull();
      expect(normalizeWhitespace(null)).toBeNull();
    });
  });

  describe('deriveItemName', () => {
    it('uses product name if variant is empty or "(single option)"', () => {
      expect(deriveItemName('Homemade Rice Krispie Treats', '(single option)')).toBe(
        'Homemade Rice Krispie Treats',
      );
      expect(deriveItemName('Cadence Gel', '')).toBe('Cadence Gel');
      expect(deriveItemName('Cadence Gel', null)).toBe('Cadence Gel');
    });

    it('uses variant name if it already starts with product name', () => {
      expect(
        deriveItemName('Barebells Protein Bar', 'Barebells Protein Bar - Caramel Cashew'),
      ).toBe('Barebells Protein Bar - Caramel Cashew');
      expect(deriveItemName('Protein Shakes', 'Protein Shakes - Extra Scoop')).toBe(
        'Protein Shakes - Extra Scoop',
      );
    });

    it('collapses double spaces in product name and variant', () => {
      expect(
        deriveItemName('Merch -  Womens SL x PUMA Cloud-spun sleeveless Training Tank', 'Small'),
      ).toBe('Merch - Womens SL x PUMA Cloud-spun sleeveless Training Tank - Small');
    });

    it('combines Product - Variant otherwise', () => {
      expect(deriveItemName('Coffee', 'Americano')).toBe('Coffee - Americano');
      expect(deriveItemName('ABE', 'Orange Burst')).toBe('ABE - Orange Burst');
      expect(deriveItemName('Water', '500 Ml')).toBe('Water - 500 Ml');
    });
  });

  describe('runSeed with isDryRun: true', () => {
    it('reads all 61 store items without writing to the database', async () => {
      const initialItemCount = await prisma.cafeItem.count();
      const initialCategoryCount = await prisma.cafeCategory.count();

      const result = await runSeed({ isDryRun: true });

      expect(result.isDryRun).toBe(true);
      expect(result.stats.totalRead).toBe(61);
      expect(
        result.stats.itemsCreated + result.stats.itemsUpdated + result.stats.itemsSkipped,
      ).toBe(61);
      expect(result.stats.untrackedCount).toBe(18);
      expect(result.stats.trackedTotal).toBe(43);
      expect(result.stats.trackedSoldOut).toBe(23);
      expect(result.stats.trackedAvailable).toBe(20);
      expect(result.stats.imageUrlCount).toBe(61);
      expect(result.stats.imageNullCount).toBe(0);
      expect(result.stats.imageNonHttpsCount).toBe(0);
      expect(result.items).toHaveLength(61);
      expect(result.ambiguousRows.length).toBeGreaterThan(0);

      // Verify no database mutation occurred
      const afterItemCount = await prisma.cafeItem.count();
      const afterCategoryCount = await prisma.cafeCategory.count();

      expect(afterItemCount).toBe(initialItemCount);
      expect(afterCategoryCount).toBe(initialCategoryCount);
    });

    it('accurately configures untracked products (Coffee, Shakes, Coolers)', async () => {
      const result = await runSeed({ isDryRun: true });

      const untrackedItems = result.items.filter((item) => !item.isTracked);
      expect(untrackedItems).toHaveLength(18);

      for (const item of untrackedItems) {
        expect(item.stockQuantity).toBeNull();
        expect(item.unitCost).toBeNull();
        expect(item.availability).toBe('AVAILABLE');
      }
    });

    it('maps STYRKR items to Supplements category', async () => {
      const result = await runSeed({ isDryRun: true });

      const styrkrItems = result.items.filter((item) => item.name.startsWith('STYRKR'));
      expect(styrkrItems).toHaveLength(13);

      for (const item of styrkrItems) {
        expect(item.categoryName).toBe('Supplements');
      }

      // Check combined category is not created
      const categories = result.categories.map((c) => c.name);
      expect(categories).not.toContain('Protein supplements, Supplements');
      expect(categories).toContain('Supplements');
    });
  });

  describe('runSeed default skip vs --force modes', () => {
    it('default skip mode leaves edited item unchanged, --force overwrites it', async () => {
      const sample = await prisma.cafeItem.findFirst({
        where: { externalRef: { not: null } },
      });
      expect(sample).toBeDefined();

      const originalPrice = Number(sample.priceAed);
      const modifiedPrice = 999.0;

      // Simulate an admin editing an item's price
      await prisma.cafeItem.update({
        where: { id: sample.id },
        data: { priceAed: modifiedPrice },
      });

      // 1. Run seed with default (skip existing)
      const skipRes = await runSeed({ isDryRun: false, isForce: false });

      expect(skipRes.stats.itemsSkipped).toBe(61);
      expect(skipRes.stats.itemsUpdated).toBe(0);
      expect(skipRes.stats.categoriesCreated).toBe(0);

      // Verify the item's edited price was preserved in DB
      const afterSkip = await prisma.cafeItem.findUnique({ where: { id: sample.id } });
      expect(Number(afterSkip.priceAed)).toBe(modifiedPrice);

      // 2. Now run with --force
      const forceRes = await runSeed({ isDryRun: false, isForce: true });

      expect(forceRes.stats.itemsUpdated).toBe(61);
      expect(forceRes.stats.itemsSkipped).toBe(0);

      // Verify the item was overwritten back to seed price
      const afterForce = await prisma.cafeItem.findUnique({ where: { id: sample.id } });
      expect(Number(afterForce.priceAed)).toBe(originalPrice);
    });

    it('categories behave sensibly in skip mode (no duplicates, no deletions)', async () => {
      const categoriesBefore = await prisma.cafeCategory.count();
      const res = await runSeed({ isDryRun: false, isForce: false });

      expect(res.stats.categoriesCreated).toBe(0);
      const categoriesAfter = await prisma.cafeCategory.count();
      expect(categoriesAfter).toBe(categoriesBefore);
      expect(categoriesAfter).toBe(12);
    });
  });
});
