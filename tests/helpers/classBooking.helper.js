const crypto = require('crypto');
const prisma = require('../../src/config/prisma');

// There is no public booking endpoint yet, so tests create bookings straight in the database.
// `state` defaults to BOOKED; a CANCELLED booking gets its cancelledAt.
const createTestBooking = (
  { sessionId, memberId, state = 'BOOKED', cancelledAt },
  client = prisma,
) =>
  client.classBooking.create({
    data: {
      id: crypto.randomUUID(),
      sessionId,
      memberId,
      state,
      cancelledAt: state === 'CANCELLED' ? (cancelledAt ?? new Date()) : null,
    },
  });

module.exports = { createTestBooking };
