const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const prisma = require('../../src/config/prisma');
const { DbCafeItemAvailability, DbCafeItemVisibility } = require('../../src/constants/cafe');
const { createRowReader } = require('./xlsx.util');

const CAFE_SEED_CONFIG = {
  defaultPath: path.join(__dirname, '../../docs/Spirit_Level_Glofox_Business_Data.xlsx'),
  sheetName: 'Store',
  headerRow: 4,
};

const UNTRACKED_PRODUCTS = new Set(['coffee', 'protein shakes', 'protein coolers']);

const normalizeWhitespace = (str) => {
  if (!str) return null;
  const collapsed = String(str).replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
};

const deriveItemName = (product, variant) => {
  const p = normalizeWhitespace(product) || '';
  const v = normalizeWhitespace(variant) || '';
  if (!v || v === '(single option)' || v.toLowerCase() === p.toLowerCase()) {
    return p;
  }
  if (v.toLowerCase().startsWith(p.toLowerCase())) {
    return v;
  }
  return `${p} - ${v}`;
};

const runSeed = async ({
  filePath = CAFE_SEED_CONFIG.defaultPath,
  isDryRun = false,
  isForce = false,
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.getWorksheet(CAFE_SEED_CONFIG.sheetName);
  if (!worksheet) {
    throw new Error(`Worksheet "${CAFE_SEED_CONFIG.sheetName}" not found in ${filePath}`);
  }

  const readRow = createRowReader(worksheet, CAFE_SEED_CONFIG.headerRow);

  const stats = {
    totalRead: 0,
    categoriesCreated: 0,
    categoriesExisting: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsSkipped: 0,
    untrackedCount: 0,
    trackedTotal: 0,
    trackedSoldOut: 0,
    trackedAvailable: 0,
    zeroStockCount: 0,
    imageUrlCount: 0,
    imageNullCount: 0,
    imageNonHttpsCount: 0,
  };

  const ambiguousRows = [];
  const plannedCategories = new Map(); // normalizedName -> { id, name, isNew }
  const plannedItems = [];
  const reservedItemNames = new Set(); // lowercase names claimed by this run or existing DB rows

  // 1. Preload existing categories from DB
  const existingCategories = await prisma.cafeCategory.findMany();
  for (const cat of existingCategories) {
    plannedCategories.set(cat.name.trim().toLowerCase(), {
      id: cat.id,
      name: cat.name,
      isNew: false,
    });
  }

  // 2. Preload existing items by externalRef
  const existingItems = await prisma.cafeItem.findMany({
    select: { id: true, externalRef: true, name: true },
  });
  const existingItemMap = new Map();
  for (const item of existingItems) {
    if (item.externalRef) {
      existingItemMap.set(item.externalRef, item);
    }
    if (item.name) reservedItemNames.add(item.name.trim().toLowerCase());
  }

  // 3. Scan rows
  for (
    let rowNumber = CAFE_SEED_CONFIG.headerRow + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber++
  ) {
    const row = worksheet.getRow(rowNumber);
    const rawProduct = readRow(row, 'Product');
    const rawExternalRef = readRow(row, 'Glofox variant ID');

    // Skip empty or unkeyed rows
    if (!rawProduct || !rawExternalRef) {
      continue;
    }

    stats.totalRead++;

    const product = normalizeWhitespace(rawProduct);
    const externalRef = normalizeWhitespace(rawExternalRef);
    const rawCategory = readRow(row, 'Category');
    const description = normalizeWhitespace(readRow(row, 'Description'));
    const variant = normalizeWhitespace(readRow(row, 'Variant / option'));
    const rawPrice = readRow(row, 'Price (AED)');
    const rawStock = readRow(row, 'Stock (at extraction)');
    const rawVisibility = readRow(row, 'Visibility');
    const rawImageUrl = readRow(row, 'Image URL');
    const imageUrl = normalizeWhitespace(rawImageUrl);

    // Track Image URL statistics
    if (imageUrl) {
      stats.imageUrlCount++;
      if (!imageUrl.startsWith('https://')) {
        stats.imageNonHttpsCount++;
      }
    } else {
      stats.imageNullCount++;
    }

    // Check ambiguous category rows & STYRKR rule
    let categoryName = normalizeWhitespace(rawCategory);
    if (!categoryName) {
      categoryName = product;
      ambiguousRows.push({
        row: rowNumber,
        product,
        variant,
        reason: 'BLANK_CATEGORY',
        details: `Category column is empty; falling back to Product name "${categoryName}".`,
      });
    } else if (categoryName.includes(',')) {
      ambiguousRows.push({
        row: rowNumber,
        product,
        variant,
        reason: 'COMMA_SEPARATED_CATEGORY',
        details: `Category contains comma-separated values: "${categoryName}". Mapped to "Supplements".`,
      });
      categoryName = 'Supplements';
    }

    const normCatKey = categoryName.toLowerCase();
    let catRecord = plannedCategories.get(normCatKey);
    if (!catRecord) {
      catRecord = {
        id: crypto.randomUUID(),
        name: categoryName,
        isNew: true,
      };
      plannedCategories.set(normCatKey, catRecord);
      stats.categoriesCreated++;
    }

    // Determine tracked vs untracked
    const isUntracked = UNTRACKED_PRODUCTS.has(product.toLowerCase());
    const isTracked = !isUntracked;

    let stockQuantity;
    let unitCost;
    let availability;

    if (isUntracked) {
      stats.untrackedCount++;
      stockQuantity = null;
      unitCost = null;
      availability = DbCafeItemAvailability.AVAILABLE;
    } else {
      stats.trackedTotal++;
      const parsedStock = parseInt(rawStock, 10);
      stockQuantity = Number.isInteger(parsedStock) && parsedStock >= 0 ? parsedStock : 0;
      unitCost = '0.00';
      if (stockQuantity === 0) {
        stats.trackedSoldOut++;
        availability = DbCafeItemAvailability.SOLD_OUT;
      } else {
        stats.trackedAvailable++;
        availability = DbCafeItemAvailability.AVAILABLE;
      }
    }

    // Visibility
    const visibility =
      rawVisibility.trim().toLowerCase() === 'hidden'
        ? DbCafeItemVisibility.STAFF_ONLY
        : DbCafeItemVisibility.PUBLIC;

    // Item name (case-insensitive unique across catalogue)
    let itemName = deriveItemName(product, variant);
    const existing = existingItemMap.get(externalRef);

    // Price
    const priceAed = parseFloat(rawPrice) || 0;

    if (existing) {
      if (isForce) {
        stats.itemsUpdated++;
        // Updating this row frees its old name for reuse by itself.
        if (existing.name) reservedItemNames.delete(existing.name.trim().toLowerCase());
      } else {
        stats.itemsSkipped++;
      }
    } else {
      stats.itemsCreated++;
    }

    if (!existing || isForce) {
      let uniqueName = itemName;
      let suffix = 2;
      while (reservedItemNames.has(uniqueName.toLowerCase())) {
        uniqueName = `${itemName} (${externalRef.slice(-6) || suffix})`;
        suffix += 1;
      }
      itemName = uniqueName;
      reservedItemNames.add(itemName.toLowerCase());
    }

    plannedItems.push({
      rowNumber,
      externalRef,
      name: itemName,
      categoryName: catRecord.name,
      categoryId: catRecord.id,
      description,
      priceAed,
      stockQuantity,
      unitCost,
      isTracked,
      availability,
      visibility,
      imageUrl,
      isNew: !existing,
      shouldUpdate: Boolean(existing && isForce),
      shouldSkip: Boolean(existing && !isForce),
    });
  }

  // Update existing categories count & backward compatibility
  stats.categoriesExisting = plannedCategories.size - stats.categoriesCreated;
  stats.zeroStockCount = stats.trackedSoldOut;

  // 4. If not dry-run, execute database writes
  if (!isDryRun) {
    // A. Upsert newly discovered categories
    for (const cat of plannedCategories.values()) {
      if (cat.isNew) {
        const created = await prisma.cafeCategory.upsert({
          where: { id: cat.id },
          update: {},
          create: {
            id: cat.id,
            name: cat.name,
            description: null,
          },
        });
        cat.id = created.id;
      }
    }

    // B. Insert new items or update existing when --force is set
    for (const item of plannedItems) {
      if (item.isNew) {
        await prisma.cafeItem.create({
          data: {
            id: crypto.randomUUID(),
            externalRef: item.externalRef,
            name: item.name,
            categoryId: item.categoryId,
            description: item.description,
            priceAed: item.priceAed,
            imageUrl: item.imageUrl,
            availability: item.availability,
            visibility: item.visibility,
            isTracked: item.isTracked,
            stockQuantity: item.stockQuantity,
            unitCost: item.unitCost,
          },
        });
      } else if (item.shouldUpdate) {
        await prisma.cafeItem.update({
          where: { externalRef: item.externalRef },
          data: {
            name: item.name,
            categoryId: item.categoryId,
            description: item.description,
            priceAed: item.priceAed,
            imageUrl: item.imageUrl,
            availability: item.availability,
            visibility: item.visibility,
            isTracked: item.isTracked,
            stockQuantity: item.stockQuantity,
            unitCost: item.unitCost,
          },
        });
      }
    }
  }

  return {
    isDryRun,
    isForce,
    stats,
    ambiguousRows,
    categories: Array.from(plannedCategories.values()),
    items: plannedItems,
  };
};

// Executable CLI entrypoint
if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  const isForce = process.argv.includes('--force');
  const targetFile =
    process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.xlsx')) ||
    process.env.SEED_CAFE_FILE ||
    CAFE_SEED_CONFIG.defaultPath;

  runSeed({ filePath: targetFile, isDryRun, isForce })
    .then((result) => {
      process.stdout.write('\n=======================================================\n');
      process.stdout.write(
        `      GLOFOX CAFE SEED REPORT ${result.isDryRun ? '(DRY RUN - NO WRITES)' : '(COMMITTED)'}      \n`,
      );
      process.stdout.write('=======================================================\n');
      process.stdout.write(`Rows Read:                 ${result.stats.totalRead}\n`);
      process.stdout.write(`Categories to Create:      ${result.stats.categoriesCreated}\n`);
      process.stdout.write(`Categories Existing:       ${result.stats.categoriesExisting}\n`);
      process.stdout.write(`Items to Create:           ${result.stats.itemsCreated}\n`);
      process.stdout.write(`Items to Update:           ${result.stats.itemsUpdated}\n`);
      process.stdout.write(`Items Skipped:             ${result.stats.itemsSkipped}\n`);
      process.stdout.write(`Items Untracked:           ${result.stats.untrackedCount}\n`);
      process.stdout.write(`Tracked Items Total:       ${result.stats.trackedTotal}\n`);
      process.stdout.write(`Tracked Items Sold Out:    ${result.stats.trackedSoldOut}\n`);
      process.stdout.write(`Tracked Items Available:   ${result.stats.trackedAvailable}\n`);
      process.stdout.write('-------------------------------------------------------\n');
      process.stdout.write(`Image URLs Present:        ${result.stats.imageUrlCount}\n`);
      process.stdout.write(`Image URLs Null:           ${result.stats.imageNullCount}\n`);
      process.stdout.write(`Image URLs Non-HTTPS:      ${result.stats.imageNonHttpsCount}\n`);
      process.stdout.write('-------------------------------------------------------\n');

      if (result.categories.length > 0) {
        process.stdout.write(`\nCategories (${result.categories.length}):\n`);
        result.categories.forEach((c) => {
          process.stdout.write(`  - ${c.name} [${c.isNew ? 'NEW' : 'EXISTS'}]\n`);
        });
      }

      process.stdout.write(`\nPlanned Items (${result.items.length}):\n`);
      result.items.forEach((item) => {
        const stockStr = item.isTracked ? `stock=${item.stockQuantity}` : 'stock=null';
        const costStr = item.isTracked ? `unitCost=${item.unitCost}` : 'unitCost=null';
        const actionStr = item.isNew ? 'CREATE' : item.shouldUpdate ? 'UPDATE' : 'SKIP';
        process.stdout.write(
          `  Row ${item.rowNumber.toString().padStart(2)}: "${item.name}" | cat="${item.categoryName}" | price=${item.priceAed.toFixed(2)} AED | ${stockStr} | ${costStr} | tracked=${item.isTracked} | avail=${item.availability} | vis=${item.visibility} [${actionStr}]\n`,
        );
      });

      if (result.ambiguousRows.length > 0) {
        process.stdout.write(`\nAmbiguous & Mapped Rows (${result.ambiguousRows.length}):\n`);
        result.ambiguousRows.forEach((a) => {
          process.stdout.write(
            `  Row ${a.row} [${a.reason}]: "${a.product}" (variant: "${a.variant}") -> ${a.details}\n`,
          );
        });
      }

      return prisma.$disconnect();
    })
    .catch((err) => {
      process.stderr.write(`\nCafe seed error: ${err.message || err}\n`);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}

module.exports = {
  runSeed,
  CAFE_SEED_CONFIG,
  UNTRACKED_PRODUCTS,
  normalizeWhitespace,
  deriveItemName,
};
