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
 * Handles booking cancellation side effects (credit restoration, waitlist notifications).
 * @param {string} _sessionId
 * @param {string} _reason
 * @returns {Promise<{ booking: any, credit: any, waitlist: any }>}
 */
const getCancelOutcome = async (_sessionId, _reason) => {
  // TODO: Wire to booking/credit engine when cancellation review flow lands.
  return {
    booking: null,
    credit: null,
    waitlist: null,
  };
};

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
