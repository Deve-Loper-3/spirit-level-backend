-- Rollback migration for 20261027140000_add_memberships_and_plan_fields

ALTER TABLE "membership_plans" DROP CONSTRAINT IF EXISTS "membership_plans_membershipId_fkey";
DROP INDEX IF EXISTS "membership_plans_membershipId_idx";

ALTER TABLE "membership_plans"
    DROP COLUMN IF EXISTS "membershipId",
    DROP COLUMN IF EXISTS "term",
    DROP COLUMN IF EXISTS "recurring",
    DROP COLUMN IF EXISTS "periodMonths",
    DROP COLUMN IF EXISTS "joiningFee";

DROP INDEX IF EXISTS "memberships_name_lower_idx";
DROP TABLE IF EXISTS "memberships";
