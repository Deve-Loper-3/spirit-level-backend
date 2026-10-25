-- Rollback for 20261026090000_add_plan_list_index
DROP INDEX IF EXISTS "membership_plans_status_creditType_idx";
