-- Rollback for 20261111110000_add_appointments
-- Drops both tables (all appointment data is lost) and the AppointmentState enum, removes the four new
-- AuditAction values (audit rows that use them are DELETED first, because enum values cannot be dropped
-- in place) and removes this migration's row so `prisma migrate deploy` can re-apply it.
-- The rebuilt AuditAction keeps every value from the earlier migrations (S1 coach availability, booking rules).
DROP TABLE IF EXISTS "appointments";
DROP TABLE IF EXISTS "appointment_types";
DROP TYPE IF EXISTS "AppointmentState";

DELETE FROM "AuditLog" WHERE "action"::text IN (
  'APPOINTMENT_TYPE_CREATED',
  'APPOINTMENT_TYPE_UPDATED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CANCELLED'
);

ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
CREATE TYPE "AuditAction" AS ENUM (
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'STAFF_CREATED', 'STAFF_CREATE_DENIED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_OTP_VERIFIED', 'PASSWORD_RESET_OTP_FAILED',
  'PASSWORD_RESET_COMPLETED', 'LOGOUT', 'COACH_UPDATED', 'COACH_STATUS_CHANGED',
  'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_STATUS_CHANGED', 'CAFE_ORDER_STATUS_CHANGED',
  'COACH_AVAILABILITY_UPDATED', 'COACH_UNAVAILABILITY_CREATED', 'COACH_UNAVAILABILITY_UPDATED',
  'COACH_UNAVAILABILITY_DELETED', 'SESSION_COACH_REPLACED',
  'BOOKING_RULE_CREATED', 'BOOKING_RULE_UPDATED', 'BOOKING_RULE_DELETED'
);
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";
DROP TYPE "AuditAction_old";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111110000_add_appointments';
