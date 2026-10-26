-- Rollback migration for 20261026180000_update_class_template_crud

ALTER TABLE "class_sessions" DROP COLUMN IF EXISTS "overriddenFields";

DROP INDEX IF EXISTS "classes_status_idx";
DROP INDEX IF EXISTS "classes_name_lower_active_idx";
ALTER TABLE "classes" DROP CONSTRAINT IF EXISTS "classes_classpass_enabled_check";

ALTER TABLE "classes" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "classes" SET "active" = ("status" = 'ACTIVE');

CREATE INDEX "classes_active_idx" ON "classes"("active");
CREATE UNIQUE INDEX "classes_name_lower_active_idx" ON "classes" (LOWER("name")) WHERE "active";

ALTER TABLE "classes"
  ALTER COLUMN "intensity" DROP NOT NULL,
  DROP COLUMN "classPassEnabled",
  DROP COLUMN "classType",
  DROP COLUMN "status";

DROP TYPE IF EXISTS "ClassType";
DROP TYPE IF EXISTS "ClassStatus";
