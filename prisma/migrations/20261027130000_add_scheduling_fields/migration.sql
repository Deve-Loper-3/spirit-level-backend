-- Add timezone to classes
ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai';

-- Add startDate and endTime to class_slots
ALTER TABLE "class_slots"
  ADD COLUMN IF NOT EXISTS "startDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS "endTime" TIME(0);

-- Backfill endTime for existing slots from startTime + durationMin
UPDATE "class_slots" cs
SET "endTime" = (cs."startTime" + (c."durationMin" || ' minutes')::interval)::time
FROM "classes" c
WHERE cs."classId" = c.id AND cs."endTime" IS NULL;

-- If any slot still has null endTime, default to startTime + 60 minutes
UPDATE "class_slots"
SET "endTime" = ("startTime" + interval '60 minutes')::time
WHERE "endTime" IS NULL;

-- Enforce NOT NULL on endTime
ALTER TABLE "class_slots" ALTER COLUMN "endTime" SET NOT NULL;

-- Replace unconditional unique constraint with partial unique index (only active slots)
DROP INDEX IF EXISTS "class_slots_classId_dayOfWeek_startTime_key";
CREATE UNIQUE INDEX IF NOT EXISTS "class_slots_active_unique_idx"
  ON "class_slots" ("classId", "dayOfWeek", "startTime") WHERE "active" = true;

CREATE INDEX IF NOT EXISTS "class_slots_classId_idx" ON "class_slots" ("classId");

-- Add snapshot, source and override fields to class_sessions
ALTER TABLE "class_sessions"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN IF NOT EXISTS "durationMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "intensity" INTEGER,
  ADD COLUMN IF NOT EXISTS "classType" TEXT,
  ADD COLUMN IF NOT EXISTS "facility" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "image" TEXT,
  ADD COLUMN IF NOT EXISTS "overrideDetails" JSONB NOT NULL DEFAULT '{}';

-- Backfill source
UPDATE "class_sessions"
SET "source" = CASE WHEN "slotId" IS NOT NULL THEN 'GENERATED' ELSE 'ONE_OFF' END;

-- Backfill snapshot fields from classes
UPDATE "class_sessions" cs
SET
  "durationMin" = COALESCE(cs."durationMin", c."durationMin"),
  "intensity" = COALESCE(cs."intensity", c."intensity"),
  "classType" = COALESCE(cs."classType", c."classType"::text),
  "description" = COALESCE(cs."description", c."description"),
  "image" = COALESCE(cs."image", c."photoUrl")
FROM "classes" c
WHERE cs."classId" = c.id;

-- Add indexes
CREATE INDEX IF NOT EXISTS "class_sessions_startAt_classId_idx" ON "class_sessions" ("startAt", "classId");
CREATE INDEX IF NOT EXISTS "class_sessions_slotId_startAt_idx" ON "class_sessions" ("slotId", "startAt");
CREATE INDEX IF NOT EXISTS "class_session_coaches_coachId_sessionId_idx" ON "class_session_coaches" ("coachId", "sessionId");
