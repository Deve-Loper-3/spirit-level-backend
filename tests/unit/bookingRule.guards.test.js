const {
  BookingWindowStatus,
  getBookingWindowStatus,
  isFreeCancellation,
  hasWaitlistRoom,
  isWithinGuestLimit,
  isWithinWeeklyLimit,
  limitToVisibleDays,
} = require('../../src/services/bookingRule.guards');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-10T08:00:00.000Z');
const startIn = (hours) => new Date(NOW.getTime() + hours * HOUR);

describe('getBookingWindowStatus (opens 504 h, closes 1 h before the class)', () => {
  const status = (hours, rules = { opensHours: 504, closesHours: 1 }) =>
    getBookingWindowStatus({ now: NOW, startAt: startIn(hours), ...rules });

  it.each([
    [600, BookingWindowStatus.NOT_OPEN],
    [504.01, BookingWindowStatus.NOT_OPEN],
    [504, BookingWindowStatus.OPEN],
    [100, BookingWindowStatus.OPEN],
    [1, BookingWindowStatus.OPEN],
    [0.99, BookingWindowStatus.CLOSED],
    [0, BookingWindowStatus.CLOSED],
    [-3, BookingWindowStatus.CLOSED],
  ])('a class starting in %s h is %s', (hours, expected) => {
    expect(status(hours)).toBe(expected);
  });

  it('uses the appointment numbers the same way (opens 336 h, closes 12 h)', () => {
    const appointment = { opensHours: 336, closesHours: 12 };
    expect(status(400, appointment)).toBe(BookingWindowStatus.NOT_OPEN);
    expect(status(48, appointment)).toBe(BookingWindowStatus.OPEN);
    expect(status(11, appointment)).toBe(BookingWindowStatus.CLOSED);
  });

  it('has no opening limit when the opening rule is off', () => {
    expect(status(5000, { opensHours: null, closesHours: 1 })).toBe(BookingWindowStatus.OPEN);
  });

  it('has no closing limit when the closing rule is off, even for a class that started', () => {
    expect(status(-3, { opensHours: 504, closesHours: null })).toBe(BookingWindowStatus.OPEN);
  });

  it('is always open when both rules are off', () => {
    expect(status(99999, { opensHours: null, closesHours: null })).toBe(BookingWindowStatus.OPEN);
  });
});

describe('isFreeCancellation', () => {
  const free = (hours, freeCancelHours) =>
    isFreeCancellation({ now: NOW, startAt: startIn(hours), freeCancelHours });

  it.each([
    [24, 12, true],
    [12.01, 12, true],
    [12, 12, true],
    [11.99, 12, false],
    [0, 12, false],
    [-1, 12, false],
    [1, 1, true],
    [0.5, 1, false],
  ])('%s h before the class with a %s h limit is free: %s', (hours, limit, expected) => {
    expect(free(hours, limit)).toBe(expected);
  });

  it('is always free when the rule is off', () => {
    expect(free(0.1, null)).toBe(true);
    expect(free(-5, null)).toBe(true);
  });
});

describe('hasWaitlistRoom (max 4 per class)', () => {
  it.each([
    [0, true],
    [3, true],
    [4, false],
    [9, false],
  ])('%s already waiting: room is %s', (waitlistCount, expected) => {
    expect(hasWaitlistRoom({ waitlistCount, maxPerClass: 4 })).toBe(expected);
  });

  it('has no limit when the rule is off', () => {
    expect(hasWaitlistRoom({ waitlistCount: 500, maxPerClass: null })).toBe(true);
  });
});

describe('isWithinGuestLimit (max 1 guest per member)', () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
  ])('%s guest(s) after this booking: allowed is %s', (guestCount, expected) => {
    expect(isWithinGuestLimit({ guestCount, maxGuests: 1 })).toBe(expected);
  });

  it('has no limit when the rule is off', () => {
    expect(isWithinGuestLimit({ guestCount: 10, maxGuests: null })).toBe(true);
  });
});

describe('isWithinWeeklyLimit (max 2 classes per week)', () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
    [5, false],
  ])('%s booked this week: one more allowed is %s', (bookedThisWeek, expected) => {
    expect(isWithinWeeklyLimit({ bookedThisWeek, maxPerWeek: 2 })).toBe(expected);
  });

  it('has no restriction when the rule is off', () => {
    expect(isWithinWeeklyLimit({ bookedThisWeek: 40, maxPerWeek: null })).toBe(true);
  });
});

describe('limitToVisibleDays (timetable visible 21 days ahead)', () => {
  const range = (fromDays, toDays) => ({
    from: new Date(NOW.getTime() + fromDays * DAY),
    to: new Date(NOW.getTime() + toDays * DAY),
  });
  const limit = (fromDays, toDays, days = 21) =>
    limitToVisibleDays({ ...range(fromDays, toDays), now: NOW, days });

  it('keeps a range that ends inside the visible window', () => {
    expect(limit(1, 7)).toEqual(range(1, 7));
  });

  it('cuts the end of a range that crosses the limit, and keeps the start', () => {
    expect(limit(10, 60)).toEqual(range(10, 21));
  });

  it('keeps a range that ends exactly on the limit', () => {
    expect(limit(5, 21)).toEqual(range(5, 21));
  });

  it('returns null when the whole range is beyond the limit', () => {
    expect(limit(22, 30)).toBeNull();
  });

  it('keeps a range that starts exactly on the limit', () => {
    expect(limit(21, 30)).toEqual(range(21, 21));
  });

  it('follows the rule value', () => {
    expect(limit(0, 60, 5)).toEqual(range(0, 5));
    expect(limit(0, 60, 365)).toEqual(range(0, 60));
  });

  it('does not change the range when the rule is off', () => {
    expect(limit(100, 190, null)).toEqual(range(100, 190));
  });

  it('does not change the input dates', () => {
    const input = range(10, 60);
    const copy = { from: new Date(input.from), to: new Date(input.to) };
    limitToVisibleDays({ ...input, now: NOW, days: 21 });
    expect(input).toEqual(copy);
  });
});
