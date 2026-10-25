-- Rollback for 20261024160000_add_membership_plans
-- Run the whole file in order. Run it only when you really want to undo this migration.

-- 1. Drop trigger and trigger function
DROP TRIGGER IF EXISTS trg_bump_membership_plan_version ON "membership_plans";
DROP FUNCTION IF EXISTS bump_membership_plan_version();

-- 2. Drop table (its indexes and CHECK constraints go with it)
DROP TABLE IF EXISTS "membership_plans";

-- 3. Drop enums (after the table, because the table uses them)
DROP TYPE IF EXISTS "PlanStatus";
DROP TYPE IF EXISTS "PlanVisibility";
DROP TYPE IF EXISTS "PlanStartsOn";
DROP TYPE IF EXISTS "PlanValidityUnit";
DROP TYPE IF EXISTS "PlanCreditRefill";
DROP TYPE IF EXISTS "PlanCreditType";
DROP TYPE IF EXISTS "PlanBillingCycle";
DROP TYPE IF EXISTS "PlanKind";

-- 4. Keep Prisma history in sync: run this only after the drops above,
--    otherwise `prisma migrate deploy` will think this migration is still applied.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261024160000_add_membership_plans';