-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassType" AS ENUM ('ONSITE', 'ONLINE');

-- AlterTable
ALTER TABLE "classes"
  ADD COLUMN "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "classType" "ClassType" NOT NULL DEFAULT 'ONSITE',
  ADD COLUMN "classPassEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill status from active
UPDATE "classes"
SET "status" = CASE WHEN "active" = true THEN 'ACTIVE'::"ClassStatus" ELSE 'DEACTIVATED'::"ClassStatus" END;

-- Backfill classPassEnabled from classpassSpots
UPDATE "classes"
SET "classPassEnabled" = CASE WHEN "classpassSpots" > 0 THEN true ELSE false END;

-- Backfill intensity to default 3 for any null values before enforcing NOT NULL
-- NOTE: 3 is a placeholder backfill for seeded classes and will be reviewed with product
UPDATE "classes"
SET "intensity" = 3 WHERE "intensity" IS NULL;

ALTER TABLE "classes" ALTER COLUMN "intensity" SET NOT NULL;

-- Drop old active column & index
DROP INDEX IF EXISTS "classes_active_idx";
DROP INDEX IF EXISTS "classes_name_lower_active_idx";
ALTER TABLE "classes" DROP COLUMN "active";

-- New status index and partial unique active name index
CREATE INDEX "classes_status_idx" ON "classes"("status");
CREATE UNIQUE INDEX "classes_name_lower_active_idx" ON "classes" (LOWER("name")) WHERE "status" = 'ACTIVE';

-- Check constraint for classPassEnabled and classpassSpots
ALTER TABLE "classes"
  ADD CONSTRAINT "classes_classpass_enabled_check"
  CHECK (("classPassEnabled" = false AND "classpassSpots" = 0) OR ("classPassEnabled" = true AND "classpassSpots" >= 0 AND "classpassSpots" <= "baseCapacity"));

-- AlterTable class_sessions
ALTER TABLE "class_sessions"
  ADD COLUMN "overriddenFields" TEXT[] NOT NULL DEFAULT '{}';
