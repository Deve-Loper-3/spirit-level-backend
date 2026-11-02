-- CreateEnum
CREATE TYPE "CafeItemAvailability" AS ENUM ('AVAILABLE', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "CafeItemVisibility" AS ENUM ('PUBLIC', 'STAFF_ONLY');

-- CreateTable
CREATE TABLE "cafe_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_categories_pkey" PRIMARY KEY ("id")
);

-- Case-insensitive unique index on LOWER(name) for categories
CREATE UNIQUE INDEX "cafe_categories_name_lower_idx" ON "cafe_categories" (LOWER("name"));

-- CreateTable
CREATE TABLE "cafe_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "nutrition" JSONB,
    "priceAed" DECIMAL(10,2) NOT NULL,
    "imageUrl" TEXT,
    "availability" "CafeItemAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "visibility" "CafeItemVisibility" NOT NULL DEFAULT 'PUBLIC',
    "isTracked" BOOLEAN NOT NULL DEFAULT true,
    "stockQuantity" INTEGER,
    "unitCost" DECIMAL(10,2),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cafe_items_externalRef_key" ON "cafe_items"("externalRef");

-- CreateIndex
CREATE INDEX "cafe_items_categoryId_idx" ON "cafe_items"("categoryId");

-- CreateIndex
CREATE INDEX "cafe_items_visibility_idx" ON "cafe_items"("visibility");

-- CreateIndex
CREATE INDEX "cafe_items_availability_idx" ON "cafe_items"("availability");

-- CreateIndex
CREATE INDEX "cafe_items_visibility_availability_idx" ON "cafe_items"("visibility", "availability");

-- AddForeignKey
ALTER TABLE "cafe_items" ADD CONSTRAINT "cafe_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "cafe_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "cafe_items"
  ADD CONSTRAINT "cafe_items_price_aed_check" CHECK ("priceAed" > 0),
  ADD CONSTRAINT "cafe_items_stock_quantity_check" CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0),
  ADD CONSTRAINT "cafe_items_unit_cost_check" CHECK ("unitCost" IS NULL OR "unitCost" >= 0),
  ADD CONSTRAINT "cafe_items_tracked_consistency_check" CHECK (
    ("isTracked" = false AND "stockQuantity" IS NULL AND "unitCost" IS NULL) OR
    ("isTracked" = true AND "stockQuantity" IS NOT NULL AND "unitCost" IS NOT NULL)
  );

