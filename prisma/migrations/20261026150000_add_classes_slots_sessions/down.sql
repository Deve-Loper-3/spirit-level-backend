-- Rollback for 20261026150000_add_classes_slots_sessions
-- Run the whole file in order. Run it only when you really want to undo this migration.
-- It deletes every class, slot and session row.

-- 1. Drop triggers and the trigger function
DROP TRIGGER IF EXISTS trg_bump_class_session_version ON "class_sessions";
DROP TRIGGER IF EXISTS trg_bump_class_version ON "classes";
DROP FUNCTION IF EXISTS bump_row_version();

-- 2. Drop tables, children first (their indexes and CHECK constraints go with them)
DROP TABLE IF EXISTS "class_session_coaches";
DROP TABLE IF EXISTS "class_sessions";
DROP TABLE IF EXISTS "class_slot_coaches";
DROP TABLE IF EXISTS "class_slots";
DROP TABLE IF EXISTS "class_eligible_plans";
DROP TABLE IF EXISTS "class_coaches";
DROP TABLE IF EXISTS "classes";

-- 3. Drop enums (after the tables, because the tables use them)
DROP TYPE IF EXISTS "SessionState";
DROP TYPE IF EXISTS "ClassVisibility";

-- 4. Keep Prisma history in sync: run this only after the drops above,
--    otherwise `prisma migrate deploy` will think this migration is still applied.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261026150000_add_classes_slots_sessions';
