-- Reverts 20261106120000_add_cafe_orders. Destroys all cafe order data.
-- Run manually (Prisma does not apply down.sql), then delete the row for this migration from
-- "_prisma_migrations".
DROP TRIGGER IF EXISTS "cafe_order_items_snapshot_immutable" ON "cafe_order_items";
DROP FUNCTION IF EXISTS "cafe_order_items_reject_snapshot_update"();
DROP TABLE IF EXISTS "cafe_order_items";
DROP TABLE IF EXISTS "cafe_orders";
DROP TYPE IF EXISTS "CafeOrderPaymentStatus";
DROP TYPE IF EXISTS "CafeOrderStatus";
