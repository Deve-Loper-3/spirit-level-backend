-- Rollback migration for 20261102130000_add_cafe_catalogue

ALTER TABLE "cafe_items" DROP CONSTRAINT IF EXISTS "cafe_items_categoryId_fkey";
DROP TABLE IF EXISTS "cafe_items";
DROP TABLE IF EXISTS "cafe_categories";
DROP TYPE IF EXISTS "CafeItemAvailability";
DROP TYPE IF EXISTS "CafeItemVisibility";

