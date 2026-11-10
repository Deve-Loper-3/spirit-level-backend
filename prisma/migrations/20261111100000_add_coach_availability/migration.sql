-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COACH_AVAILABILITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COACH_UNAVAILABILITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COACH_UNAVAILABILITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COACH_UNAVAILABILITY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_COACH_REPLACED';

-- CreateTable
CREATE TABLE "coach_availability_days" (
    "coachId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_availability_days_pkey" PRIMARY KEY ("coachId","dayOfWeek")
);

-- CreateTable
CREATE TABLE "coach_availability_slots" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_unavailability" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_availability_slots_coachId_dayOfWeek_startTime_key" ON "coach_availability_slots"("coachId", "dayOfWeek", "startTime");

-- CreateIndex
CREATE INDEX "coach_unavailability_coachId_startDate_endDate_idx" ON "coach_unavailability"("coachId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "coach_unavailability_startDate_endDate_idx" ON "coach_unavailability"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "coach_availability_days" ADD CONSTRAINT "coach_availability_days_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability_slots" ADD CONSTRAINT "coach_availability_slots_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability_slots" ADD CONSTRAINT "coach_availability_slots_coachId_dayOfWeek_fkey" FOREIGN KEY ("coachId", "dayOfWeek") REFERENCES "coach_availability_days"("coachId", "dayOfWeek") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_unavailability" ADD CONSTRAINT "coach_unavailability_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Check Constraints (Prisma cannot express them)
ALTER TABLE "coach_availability_days"
  ADD CONSTRAINT "coach_availability_days_day_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7);

ALTER TABLE "coach_availability_slots"
  ADD CONSTRAINT "coach_availability_slots_day_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  ADD CONSTRAINT "coach_availability_slots_time_order_check" CHECK ("endTime" > "startTime");

ALTER TABLE "coach_unavailability"
  ADD CONSTRAINT "coach_unavailability_date_order_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "coach_unavailability_reason_check" CHECK (length(btrim("reason")) > 0 AND length("reason") <= 200),
  ADD CONSTRAINT "coach_unavailability_note_check" CHECK ("note" IS NULL OR length("note") <= 1000);
