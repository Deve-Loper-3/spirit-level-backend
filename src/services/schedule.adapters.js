const { cancelBookingsAndRefund } = require('./classCancellation.service');

/**
 * Out-of-scope integration seam functions (BE-SCH-1/2/3).
 * Safe defaults for booking stats, cancellation outcomes, coach qualification and leave.
 * Wire real implementations when their respective tickets land. See CODEMAP §21.
 */

/**
 * Returns booking and waitlist counts for a session.
 * @param {string} _sessionId
 * @returns {Promise<{ bookedCount: number, waitlistCount: number }>}
 */
const getBookingStats = async (_sessionId) => {
  // TODO: Wire to booking repository / service when booking ticket lands.
  return {
    bookedCount: 0,
    waitlistCount: 0,
  };
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

/**
 * Checks if a coach is qualified for a specific class template.
 * @param {string} _coachId
 * @param {string} _classId
 * @returns {Promise<boolean>}
 */
const isCoachQualified = async (_coachId, _classId) => {
  // TODO: Wire to coach certification / qualification matrix when coach ticket lands.
  return true;
};

/**
 * Checks if a coach is approved on leave during a given interval.
 * @param {string} _coachId
 * @param {Date} _startAt
 * @param {Date} _endAt
 * @returns {Promise<boolean>}
 */
const isCoachOnLeave = async (_coachId, _startAt, _endAt) => {
  // TODO: Wire to coach leave / unavailability calendar when leave ticket lands.
  return false;
};

module.exports = {
  getBookingStats,
  getCancelOutcome,
  isCoachQualified,
  isCoachOnLeave,
};
