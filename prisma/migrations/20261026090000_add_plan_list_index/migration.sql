-- CreateIndex
-- Serves the plan list (status is always filtered, the section filter uses creditType)
-- and the per-section counts of non-archived plans.
CREATE INDEX "membership_plans_status_creditType_idx" ON "membership_plans"("status", "creditType");
