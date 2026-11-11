-- AlterEnum (the new values are not used in this migration)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_TYPE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_TYPE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLED';

-- CreateEnum
CREATE TYPE "AppointmentState" AS ENUM ('BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "appointment_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "bufferBeforeMin" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "appointmentTypeId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "bufferBeforeMin" INTEGER NOT NULL,
    "bufferAfterMin" INTEGER NOT NULL,
    "state" "AppointmentState" NOT NULL DEFAULT 'BOOKED',
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_coachId_startAt_idx" ON "appointments"("coachId", "startAt");

-- CreateIndex
CREATE INDEX "appointments_memberId_startAt_idx" ON "appointments"("memberId", "startAt");

-- CreateIndex
CREATE INDEX "appointments_appointmentTypeId_idx" ON "appointments"("appointmentTypeId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "appointment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial / expression indexes (Prisma cannot express them)
-- Type name unique among ACTIVE types, case-insensitive and trimmed.
CREATE UNIQUE INDEX "appointment_types_name_active_key" ON "appointment_types" (LOWER(BTRIM("name"))) WHERE "isActive" = true;

-- Conflict lookups only read BOOKED rows.
CREATE INDEX "appointments_coachId_startAt_endAt_booked_idx" ON "appointments"("coachId", "startAt", "endAt") WHERE "state" = 'BOOKED';

-- Check Constraints (Prisma cannot express them)
ALTER TABLE "appointment_types"
  ADD CONSTRAINT "appointment_types_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "appointment_types_duration_check" CHECK ("durationMin" > 0 AND "durationMin" <= 480),
  ADD CONSTRAINT "appointment_types_buffer_before_check" CHECK ("bufferBeforeMin" >= 0),
  ADD CONSTRAINT "appointment_types_buffer_after_check" CHECK ("bufferAfterMin" >= 0);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_time_order_check" CHECK ("endAt" > "startAt"),
  ADD CONSTRAINT "appointments_buffer_before_check" CHECK ("bufferBeforeMin" >= 0),
  ADD CONSTRAINT "appointments_buffer_after_check" CHECK ("bufferAfterMin" >= 0),
  ADD CONSTRAINT "appointments_version_check" CHECK ("version" >= 1);
