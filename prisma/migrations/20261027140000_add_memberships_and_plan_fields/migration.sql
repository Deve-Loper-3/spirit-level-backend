-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- Case-insensitive unique index on LOWER(name)
CREATE UNIQUE INDEX "memberships_name_lower_idx" ON "memberships" (LOWER("name"));

-- AlterTable membership_plans: add columns
ALTER TABLE "membership_plans"
    ADD COLUMN "membershipId" TEXT,
    ADD COLUMN "term" TEXT,
    ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "periodMonths" INTEGER,
    ADD COLUMN "joiningFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "membership_plans_membershipId_idx" ON "membership_plans"("membershipId");

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing plans:
-- term=null, joiningFee=0, periodMonths derived from billingCycle (month 1, quarter 3, half-year 6, year 12, else null), recurring=true only for subscription plans.
UPDATE "membership_plans"
SET
    "term" = NULL,
    "joiningFee" = 0,
    "periodMonths" = CASE
        WHEN "billingCycle" = 'MONTH' THEN 1
        WHEN "billingCycle" = 'QUARTER' THEN 3
        WHEN "billingCycle" = 'HALF_YEAR' THEN 6
        WHEN "billingCycle" = 'YEAR' THEN 12
        ELSE NULL
    END,
    "recurring" = CASE
        WHEN "kind" = 'SUBSCRIPTION' THEN true
        ELSE false
    END;
