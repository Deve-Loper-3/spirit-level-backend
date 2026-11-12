const prisma = require('../config/prisma');
const { ClassBookingState } = require('../constants/notification');

// `client` is the prisma client or a transaction client, so callers can join their transaction.

// The BOOKED bookings of one session with the member's name and e-mail (for the notification / mail),
// in ONE query.
const findBookedBySession = (sessionId, client = prisma) =>
  client.classBooking.findMany({
    where: { sessionId, state: ClassBookingState.BOOKED },
    select: {
      id: true,
      memberId: true,
      member: { select: { fullName: true, email: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

// state and cancelledAt always change together. Only rows that are still BOOKED are touched, so a repeated
// call changes nothing. Returns the number of bookings cancelled.
const cancelBookings = async (bookingIds, cancelledAt, client = prisma) => {
  if (bookingIds.length === 0) return 0;
  const { count } = await client.classBooking.updateMany({
    where: { id: { in: bookingIds }, state: ClassBookingState.BOOKED },
    data: { state: ClassBookingState.CANCELLED, cancelledAt },
  });
  return count;
};

// Number of BOOKED bookings per session for many sessions in ONE grouped query (no N+1).
// Returns a Map sessionId -> count; a session without bookings is simply absent.
const countBookedBySessions = async (sessionIds, client = prisma) => {
  if (sessionIds.length === 0) return new Map();
  const rows = await client.classBooking.groupBy({
    by: ['sessionId'],
    where: { sessionId: { in: sessionIds }, state: ClassBookingState.BOOKED },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.sessionId, row._count._all]));
};

module.exports = { findBookedBySession, cancelBookings, countBookedBySessions };
