-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('SUBSCRIPTION', 'CREDIT_PACK', 'SINGLE_VISIT', 'TRIAL');

-- CreateEnum
CREATE TYPE "PlanBillingCycle" AS ENUM ('MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "PlanCreditType" AS ENUM ('CLASS', 'APPOINTMENT', 'FACILITY', 'TIME');

-- CreateEnum
CREATE TYPE "PlanCreditRefill" AS ENUM ('MONTHLY', 'ONCE');

-- CreateEnum
CREATE TYPE "PlanValidityUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "PlanStartsOn" AS ENUM ('PURCHASE_DATE', 'FIRST_BOOKING');

-- CreateEnum
CREATE TYPE "PlanVisibility" AS ENUM ('PUBLIC', 'HIDDEN');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PlanKind" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "billingCycle" "PlanBillingCycle" NOT NULL,
    "creditType" "PlanCreditType" NOT NULL,
    "creditsIncluded" INTEGER NOT NULL,
    "creditRefill" "PlanCreditRefill",
    "validityValue" INTEGER NOT NULL,
    "validityUnit" "PlanValidityUnit" NOT NULL,
    "startsOn" "PlanStartsOn" NOT NULL,
    "oneTimePurchasePerClient" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "PlanVisibility" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "externalRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_externalRef_key" ON "membership_plans"("externalRef");

-- CreateIndex
CREATE INDEX "membership_plans_status_idx" ON "membership_plans"("status");

-- CreateIndex
CREATE INDEX "membership_plans_kind_idx" ON "membership_plans"("kind");

-- CreateIndex
CREATE INDEX "membership_plans_creditType_idx" ON "membership_plans"("creditType");

-- Partial Case-Insensitive Unique Index on Name (Active / Non-archived)
CREATE UNIQUE INDEX "membership_plans_name_lower_active_idx" 
ON "membership_plans" (LOWER("name")) 
WHERE "status" != 'ARCHIVED';

-- Check Constraints
ALTER TABLE "membership_plans"
  ADD CONSTRAINT "membership_plans_price_check" CHECK ("price" >= 0 AND "price" <= 100000),
  ADD CONSTRAINT "membership_plans_credits_check" CHECK ("creditsIncluded" >= 0),
  ADD CONSTRAINT "membership_plans_validity_check" CHECK ("validityValue" >= 1);

-- Commercial Version Bump Trigger Function
CREATE OR REPLACE FUNCTION bump_membership_plan_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    OLD."price" IS DISTINCT FROM NEW."price" OR
    OLD."billingCycle" IS DISTINCT FROM NEW."billingCycle" OR
    OLD."creditType" IS DISTINCT FROM NEW."creditType" OR
    OLD."creditsIncluded" IS DISTINCT FROM NEW."creditsIncluded" OR
    OLD."creditRefill" IS DISTINCT FROM NEW."creditRefill" OR
    OLD."validityValue" IS DISTINCT FROM NEW."validityValue" OR
    OLD."validityUnit" IS DISTINCT FROM NEW."validityUnit"
  ) THEN
    NEW."version" = OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Commercial Version Bump Trigger
CREATE TRIGGER trg_bump_membership_plan_version
BEFORE UPDATE ON "membership_plans"
FOR EACH ROW
EXECUTE FUNCTION bump_membership_plan_version();
