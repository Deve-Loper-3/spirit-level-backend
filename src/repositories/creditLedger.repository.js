const crypto = require('crypto');
const prisma = require('../config/prisma');
const { CreditReason, CREDITS_REFUNDED_PER_BOOKING } = require('../constants/notification');

// The credit ledger is append-only: this repository only inserts.

// One refund row per booking, in ONE statement. `skipDuplicates` makes it ON CONFLICT DO NOTHING: the
// partial unique index on (bookingId, reason) for CLASS_CANCELLED_REFUND turns a repeated refund into a
// no-op instead of an error or a double credit. Returns how many rows were really inserted.
const insertClassCancelledRefunds = async (bookings, client = prisma) => {
  if (bookings.length === 0) return 0;
  const { count } = await client.memberCreditTransaction.createMany({
    data: bookings.map((booking) => ({
      id: crypto.randomUUID(),
      memberId: booking.memberId,
      delta: CREDITS_REFUNDED_PER_BOOKING,
      reason: CreditReason.CLASS_CANCELLED_REFUND,
      bookingId: booking.id,
    })),
    skipDuplicates: true,
  });
  return count;
};

module.exports = { insertClassCancelledRefunds };
