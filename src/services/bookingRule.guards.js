// Pure checks for the booking rules: no database, no clock. The caller reads the saved rules
// (getLimitValue in bookingRule.service) and passes the numbers in. A null limit means the rule is
// disabled or deleted, which is "no restriction", so every check passes.
// Used now by the member timetable; the booking, waitlist, guest, cancellation and appointment
// APIs will call the rest when they exist.

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const BookingWindowStatus = Object.freeze({
  OPEN: 'open',
  NOT_OPEN: 'not_open',
  CLOSED: 'closed',
});

const hoursUntil = (startAt, now) => (startAt.getTime() - now.getTime()) / MS_PER_HOUR;

// The opening and the closing moment themselves are still bookable. A class that already started
// is closed, unless the closing rule is off.
const getBookingWindowStatus = ({ now, startAt, opensHours, closesHours }) => {
  const hoursBefore = hoursUntil(startAt, now);
  if (closesHours !== null && hoursBefore < closesHours) return BookingWindowStatus.CLOSED;
  if (opensHours !== null && hoursBefore > opensHours) return BookingWindowStatus.NOT_OPEN;
  return BookingWindowStatus.OPEN;
};

// Cancelling exactly `freeCancelHours` before the start is still free (the credit comes back).
const isFreeCancellation = ({ now, startAt, freeCancelHours }) =>
  freeCancelHours === null || hoursUntil(startAt, now) >= freeCancelHours;

// waitlistCount is the people already on the waitlist.
const hasWaitlistRoom = ({ waitlistCount, maxPerClass }) =>
  maxPerClass === null || waitlistCount < maxPerClass;

// guestCount is the guests the member would have after this booking.
const isWithinGuestLimit = ({ guestCount, maxGuests }) =>
  maxGuests === null || guestCount <= maxGuests;

// bookedThisWeek is the classes already booked that week, so one more is allowed below the limit.
const isWithinWeeklyLimit = ({ bookedThisWeek, maxPerWeek }) =>
  maxPerWeek === null || bookedThisWeek < maxPerWeek;

// Cuts a requested time range to what a member may see: nothing later than `days` days from now.
// Returns the (possibly shorter) range, or null when the whole range lies beyond that point.
const limitToVisibleDays = ({ from, to, now, days }) => {
  if (days === null) return { from, to };
  const until = new Date(now.getTime() + days * MS_PER_DAY);
  if (from > until) return null;
  return { from, to: to > until ? until : to };
};

module.exports = {
  BookingWindowStatus,
  getBookingWindowStatus,
  isFreeCancellation,
  hasWaitlistRoom,
  isWithinGuestLimit,
  isWithinWeeklyLimit,
  limitToVisibleDays,
};
