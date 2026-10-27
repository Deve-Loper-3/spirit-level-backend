-- Drop indexes
DROP INDEX IF EXISTS "class_session_coaches_coachId_sessionId_idx";
DROP INDEX IF EXISTS "class_sessions_slotId_startAt_idx";
DROP INDEX IF EXISTS "class_sessions_startAt_classId_idx";
DROP INDEX IF EXISTS "class_slots_classId_idx";
DROP INDEX IF EXISTS "class_slots_active_unique_idx";

-- Restore original class_slots unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "class_slots_classId_dayOfWeek_startTime_key"
  ON "class_slots" ("classId", "dayOfWeek", "startTime");

-- Drop added columns from class_sessions
ALTER TABLE "class_sessions"
  DROP COLUMN IF EXISTS "overrideDetails",
  DROP COLUMN IF EXISTS "image",
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "facility",
  DROP COLUMN IF EXISTS "classType",
  DROP COLUMN IF EXISTS "intensity",
  DROP COLUMN IF EXISTS "durationMin",
  DROP COLUMN IF EXISTS "source";

-- Drop added columns from class_slots
ALTER TABLE "class_slots"
  DROP COLUMN IF EXISTS "endTime",
  DROP COLUMN IF EXISTS "startDate";

-- Drop timezone from classes
ALTER TABLE "classes"
  DROP COLUMN IF EXISTS "timezone";
