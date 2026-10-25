-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_STATUS_CHANGED';

-- AlterTable: old and new values of a change (null for actions that have none)
ALTER TABLE "AuditLog" ADD COLUMN "details" JSONB;
