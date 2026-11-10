-- Rollback for 20261111100000_add_coach_availability
-- Drops the three tables (all coach availability and unavailability data is lost), removes the five
-- AuditAction values (audit rows that use them are DELETED first, because enum values cannot be dropped
-- in place) and removes this migration's row so `prisma migrate deploy` can re-apply it.
DROP TABLE IF EXISTS "coach_availability_slots";
DROP TABLE IF EXISTS "coach_availability_days";
DROP TABLE IF EXISTS "coach_unavailability";

DELETE FROM "AuditLog" WHERE "action"::text IN (
  'COACH_AVAILABILITY_UPDATED',
  'COACH_UNAVAILABILITY_CREATED',
  'COACH_UNAVAILABILITY_UPDATED',
  'COACH_UNAVAILABILITY_DELETED',
  'SESSION_COACH_REPLACED'
);

ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
CREATE TYPE "AuditAction" AS ENUM (
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'STAFF_CREATED', 'STAFF_CREATE_DENIED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_OTP_VERIFIED', 'PASSWORD_RESET_OTP_FAILED',
  'PASSWORD_RESET_COMPLETED', 'LOGOUT', 'COACH_UPDATED', 'COACH_STATUS_CHANGED',
  'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_STATUS_CHANGED', 'CAFE_ORDER_STATUS_CHANGED'
);
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";
DROP TYPE "AuditAction_old";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111100000_add_coach_availability';
