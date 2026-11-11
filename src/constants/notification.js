// SLAPP 66/111 S11: in-app notifications and the class-cancellation credit refund (API / Prisma enum strings).
const NotificationType = Object.freeze({
  CLASS_CANCELLED: 'CLASS_CANCELLED',
});

const CreditReason = Object.freeze({
  CLASS_CANCELLED_REFUND: 'CLASS_CANCELLED_REFUND',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
});

const ClassBookingState = Object.freeze({
  BOOKED: 'BOOKED',
  CANCELLED: 'CANCELLED',
});

// Simplest rule: a cancelled class returns exactly one credit per booking.
const CREDITS_REFUNDED_PER_BOOKING = 1;

module.exports = {
  NotificationType,
  CreditReason,
  ClassBookingState,
  CREDITS_REFUNDED_PER_BOOKING,
};
