-- Rollback migration for 20261110120000_add_booking_rules
-- The AuditAction values BOOKING_RULE_CREATED / _UPDATED / _DELETED cannot be dropped with
-- ALTER TYPE. To remove them: delete AuditLog rows that use them, create a new enum type without
-- them, alter "AuditLog"."action" to it, drop the old type, then delete this migration's row from
-- "_prisma_migrations".

DROP TABLE IF EXISTS "booking_rules";
DROP TYPE IF EXISTS "BookingRuleUnit";
DROP TYPE IF EXISTS "BookingRuleCategory";
