-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'STAFF_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_CREATE_DENIED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorRole" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
