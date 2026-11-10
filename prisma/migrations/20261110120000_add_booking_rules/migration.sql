-- AlterEnum (the new values are not used in this migration)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_RULE_DELETED';

-- CreateEnum
CREATE TYPE "BookingRuleCategory" AS ENUM ('BOOKING_WINDOW', 'CANCELLATIONS', 'WAITLIST_GUESTS_CAPACITY', 'BOOKING_LIMIT', 'APPOINTMENTS', 'FACILITIES', 'MEMBERSHIPS_ACCOUNTS', 'CLASSPASS');

-- CreateEnum
CREATE TYPE "BookingRuleUnit" AS ENUM ('HOURS', 'DAYS', 'COUNT', 'PERCENT');

-- CreateTable
CREATE TABLE "booking_rules" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "category" "BookingRuleCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER,
    "unit" "BookingRuleUnit",
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_rules_ruleKey_key" ON "booking_rules"("ruleKey");

-- CreateIndex
CREATE INDEX "booking_rules_category_idx" ON "booking_rules"("category");

-- Check Constraints
-- A flag rule has neither unit nor value; every other rule has both.
ALTER TABLE "booking_rules" ADD CONSTRAINT "booking_rules_unit_value_pair_check"
  CHECK (("unit" IS NULL AND "value" IS NULL) OR ("unit" IS NOT NULL AND "value" IS NOT NULL));

-- Value bounds per unit (kept in step with UNIT_BOUNDS in src/constants/bookingRule.js).
ALTER TABLE "booking_rules" ADD CONSTRAINT "booking_rules_value_bounds_check"
  CHECK (
    "unit" IS NULL
    OR ("unit" = 'HOURS' AND "value" BETWEEN 0 AND 8760)
    OR ("unit" = 'DAYS' AND "value" BETWEEN 0 AND 365)
    OR ("unit" = 'COUNT' AND "value" BETWEEN 0 AND 1000)
    OR ("unit" = 'PERCENT' AND "value" BETWEEN 1 AND 100)
  );
