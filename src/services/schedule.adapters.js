const prisma = require('../config/prisma');
const { cancelBookingsAndRefund } = require('./classCancellation.service');
const { countBookedBySessions } = require('../repositories/classBooking.repository');

/**
 * Seam between the schedule and the booking side.
 * Booked counts are real (class_bookings). There is no waitlist table yet, so `waitlistCount` is always 0
 * (documented, CODEMAP §21): it is display only and no guard reads it for a schedule decision.
 */

const toStats = (bookedCount) => ({ bookedCount: bookedCount ?? 0, waitlistCount: 0 });

/**
 * Booking counts for one session. Pass the transaction client when called inside a transaction.
 * @param {string} sessionId
 * @param {object} [client]
 * @returns {Promise<{ bookedCount: number, waitlistCount: number }>}
 */
const getBookingStats = async (sessionId, client = prisma) => {
  const counts = await countBookedBySessions([sessionId], client);
  return toStats(counts.get(sessionId));
};

/**
 * Booking counts for many sessions in one query. Returns a Map sessionId -> stats; every requested id
 * is present (0 booked when it has no bookings).
 * @param {string[]} sessionIds
 * @param {object} [client]
 * @returns {Promise<Map<string, { bookedCount: number, waitlistCount: number }>>}
 */
const getBookingStatsMap = async (sessionIds, client = prisma) => {
  const counts = await countBookedBySessions(sessionIds, client);
  return new Map(sessionIds.map((id) => [id, toStats(counts.get(id))]));
};

/**
 * Handles the booking side of a cancelled class session (SLAPP 66/111 S11): every BOOKED booking becomes
 * CANCELLED and gets one +1 credit ledger row (idempotent). Must run inside the cancel transaction (`client`).
 * `recipients` (who to notify after the commit) is internal: the caller removes it before answering.
 * With no bookings the outcome is the same all-null object as before.
 * @param {string} sessionId
 * @param {string} _reason
 * @param {object} [client] Prisma transaction client
 * @returns {Promise<{ booking: any, credit: any, waitlist: any, recipients: any[] }>}
 */
const getCancelOutcome = async (sessionId, _reason, client) =>
  cancelBookingsAndRefund({ sessionId, client });

module.exports = {
  getBookingStats,
  getBookingStatsMap,
  getCancelOutcome,
};
