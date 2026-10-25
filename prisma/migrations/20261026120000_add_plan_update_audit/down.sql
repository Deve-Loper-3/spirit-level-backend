-- Rollback for 20261026120000_add_plan_update_audit
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "details";
-- The enum values PLAN_UPDATED and PLAN_STATUS_CHANGED cannot be dropped with ALTER TYPE.
-- To remove them: delete AuditLog rows that use them, create a new enum type without them,
-- alter "AuditLog"."action" to it, and drop the old type.
