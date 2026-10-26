-- CreateEnum
CREATE TYPE "ClassVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('OPEN', 'FULL', 'CANCELLED');

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "baseCapacity" INTEGER NOT NULL,
    "intensity" INTEGER,
    "visibility" "ClassVisibility" NOT NULL,
    "classpassSpots" INTEGER NOT NULL DEFAULT 0,
    "colour" TEXT,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "externalRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_coaches" (
    "classId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,

    CONSTRAINT "class_coaches_pkey" PRIMARY KEY ("classId","coachId")
);

-- CreateTable
CREATE TABLE "class_eligible_plans" (
    "classId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,

    CONSTRAINT "class_eligible_plans_pkey" PRIMARY KEY ("classId","planId")
);

-- CreateTable
CREATE TABLE "class_slots" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_slot_coaches" (
    "slotId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,

    CONSTRAINT "class_slot_coaches_pkey" PRIMARY KEY ("slotId","coachId")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "slotId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'OPEN',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_session_coaches" (
    "sessionId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,

    CONSTRAINT "class_session_coaches_pkey" PRIMARY KEY ("sessionId","coachId")
);

-- CreateIndex
CREATE UNIQUE INDEX "classes_externalRef_key" ON "classes"("externalRef");

-- CreateIndex
CREATE INDEX "classes_active_idx" ON "classes"("active");

-- CreateIndex
CREATE INDEX "class_coaches_coachId_idx" ON "class_coaches"("coachId");

-- CreateIndex
CREATE INDEX "class_eligible_plans_planId_idx" ON "class_eligible_plans"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "class_slots_classId_dayOfWeek_startTime_key" ON "class_slots"("classId", "dayOfWeek", "startTime");

-- CreateIndex
CREATE INDEX "class_slot_coaches_coachId_idx" ON "class_slot_coaches"("coachId");

-- CreateIndex
CREATE INDEX "class_sessions_startAt_idx" ON "class_sessions"("startAt");

-- CreateIndex
CREATE INDEX "class_sessions_slotId_idx" ON "class_sessions"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_classId_startAt_key" ON "class_sessions"("classId", "startAt");

-- CreateIndex
CREATE INDEX "class_session_coaches_coachId_idx" ON "class_session_coaches"("coachId");

-- AddForeignKey
ALTER TABLE "class_coaches" ADD CONSTRAINT "class_coaches_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_coaches" ADD CONSTRAINT "class_coaches_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_eligible_plans" ADD CONSTRAINT "class_eligible_plans_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_eligible_plans" ADD CONSTRAINT "class_eligible_plans_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_slot_coaches" ADD CONSTRAINT "class_slot_coaches_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "class_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_slot_coaches" ADD CONSTRAINT "class_slot_coaches_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "class_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session_coaches" ADD CONSTRAINT "class_session_coaches_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session_coaches" ADD CONSTRAINT "class_session_coaches_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial Case-Insensitive Unique Index on Name (active classes only)
CREATE UNIQUE INDEX "classes_name_lower_active_idx"
ON "classes" (LOWER("name"))
WHERE "active";

-- Check Constraints
ALTER TABLE "classes"
  ADD CONSTRAINT "classes_intensity_check" CHECK ("intensity" BETWEEN 1 AND 5),
  ADD CONSTRAINT "classes_base_capacity_check" CHECK ("baseCapacity" >= 1),
  ADD CONSTRAINT "classes_duration_check" CHECK ("durationMin" > 0),
  ADD CONSTRAINT "classes_classpass_spots_check" CHECK ("classpassSpots" >= 0 AND "classpassSpots" <= "baseCapacity"),
  ADD CONSTRAINT "classes_colour_check" CHECK ("colour" IS NULL OR "colour" ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE "class_slots"
  ADD CONSTRAINT "class_slots_day_of_week_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  ADD CONSTRAINT "class_slots_capacity_check" CHECK ("capacity" IS NULL OR "capacity" >= 1);

ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_time_check" CHECK ("endAt" > "startAt"),
  ADD CONSTRAINT "class_sessions_capacity_check" CHECK ("capacity" >= 1),
  ADD CONSTRAINT "class_sessions_cancel_reason_check" CHECK ("cancelReason" IS NULL OR "state" = 'CANCELLED');

-- Generic Version Bump Trigger Function: +1 when any column other than version/updatedAt changes
CREATE OR REPLACE FUNCTION bump_row_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - 'version' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'version' - 'updatedAt') THEN
    NEW."version" = OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bump_class_version
BEFORE UPDATE ON "classes"
FOR EACH ROW
EXECUTE FUNCTION bump_row_version();

CREATE TRIGGER trg_bump_class_session_version
BEFORE UPDATE ON "class_sessions"
FOR EACH ROW
EXECUTE FUNCTION bump_row_version();
