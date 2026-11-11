-- Rollback for 20261111120000_add_bookings_credits_notifications
-- Drops the three tables (all bookings, credit ledger rows and notifications are lost) and the three enums,
-- and removes this migration's row so `prisma migrate deploy` can re-apply it. AuditAction is not touched
-- by this migration, so there is no enum rebuild. Order matters: the ledger references the bookings.
DROP TABLE IF EXISTS "member_credit_transactions";
DROP TABLE IF EXISTS "notifications";
DROP TABLE IF EXISTS "class_bookings";
DROP TYPE IF EXISTS "NotificationType";
DROP TYPE IF EXISTS "CreditReason";
DROP TYPE IF EXISTS "ClassBookingState";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111120000_add_bookings_credits_notifications';
