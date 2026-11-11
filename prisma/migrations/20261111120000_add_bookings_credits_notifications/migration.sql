-- CreateEnum
CREATE TYPE "ClassBookingState" AS ENUM ('BOOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditReason" AS ENUM ('CLASS_CANCELLED_REFUND', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CLASS_CANCELLED');

-- CreateTable
CREATE TABLE "class_bookings" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "state" "ClassBookingState" NOT NULL DEFAULT 'BOOKED',
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_credit_transactions" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "CreditReason" NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_bookings_sessionId_state_idx" ON "class_bookings"("sessionId", "state");

-- CreateIndex
CREATE INDEX "class_bookings_memberId_createdAt_idx" ON "class_bookings"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "member_credit_transactions_memberId_createdAt_idx" ON "member_credit_transactions"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credit_transactions" ADD CONSTRAINT "member_credit_transactions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credit_transactions" ADD CONSTRAINT "member_credit_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "class_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial / expression indexes (Prisma cannot express them)
-- One BOOKED booking per (session, member); cancelled bookings do not count.
CREATE UNIQUE INDEX "class_bookings_session_member_booked_key" ON "class_bookings"("sessionId", "memberId") WHERE "state" = 'BOOKED';

-- A booking can be refunded for a class cancellation only once (idempotent refunds).
CREATE UNIQUE INDEX "member_credit_transactions_booking_refund_key" ON "member_credit_transactions"("bookingId", "reason") WHERE "reason" = 'CLASS_CANCELLED_REFUND' AND "bookingId" IS NOT NULL;

-- Unread counts only read the unread rows.
CREATE INDEX "notifications_userId_unread_idx" ON "notifications"("userId") WHERE "readAt" IS NULL;

-- Check Constraints (Prisma cannot express them)
ALTER TABLE "member_credit_transactions"
  ADD CONSTRAINT "member_credit_transactions_delta_check" CHECK ("delta" <> 0);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_title_check" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "notifications_body_check" CHECK (length(btrim("body")) > 0);
