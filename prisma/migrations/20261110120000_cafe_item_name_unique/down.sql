DROP INDEX IF EXISTS "cafe_items_name_lower_idx";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110120000_cafe_item_name_unique';
