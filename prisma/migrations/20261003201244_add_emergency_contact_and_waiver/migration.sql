-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('PARENT', 'SPOUSE', 'SIBLING', 'CHILD', 'FRIEND', 'GUARDIAN', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "registrationCompletedAt" TIMESTAMP(3),
ADD COLUMN     "waiverAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyContact_userId_key" ON "EmergencyContact"("userId");

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
