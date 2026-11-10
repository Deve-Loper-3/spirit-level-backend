const {
  parseHHmm,
  isValidHHmm,
  formatHHmm,
  toMinuteRange,
  isValidRange,
  rangesOverlap,
  rangeContains,
  findOverlappingPair,
  mergeRanges,
  facilityDateRangeToUtc,
  facilityDayToUtc,
} = require('../../src/utils/timeRange.util');

describe('timeRange.util', () => {
  describe('parseHHmm / isValidHHmm', () => {
    it.each([
      ['00:00', 0],
      ['00:01', 1],
      ['09:30', 570],
      ['12:00', 720],
      ['23:59', 1439],
    ])('parses %s to %i minutes', (value, minutes) => {
      expect(parseHHmm(value)).toBe(minutes);
      expect(isValidHHmm(value)).toBe(true);
    });

    it.each([
      '24:00',
      '9:30',
      '09:5',
      '09:60',
      '9:30 AM',
      '09-30',
      '0930',
      ' 09:30',
      '09:30:00',
      '',
      null,
      undefined,
      930,
    ])('rejects %p', (value) => {
      expect(parseHHmm(value)).toBeNull();
      expect(isValidHHmm(value)).toBe(false);
    });
  });

  describe('formatHHmm', () => {
    it.each([
      [0, '00:00'],
      [5, '00:05'],
      [570, '09:30'],
      [1439, '23:59'],
    ])('formats %i as %s', (minutes, text) => {
      expect(formatHHmm(minutes)).toBe(text);
    });

    it('round-trips every minute of the day', () => {
      for (let m = 0; m < 1440; m += 1) {
        expect(parseHHmm(formatHHmm(m))).toBe(m);
      }
    });

    it.each([-1, 1440, 1.5, NaN, '60', null])('throws on %p', (value) => {
      expect(() => formatHHmm(value)).toThrow(RangeError);
    });
  });

  describe('toMinuteRange / isValidRange', () => {
    it('converts a slot to a minute range', () => {
      expect(toMinuteRange({ startTime: '09:00', endTime: '10:30' })).toEqual({
        start: 540,
        end: 630,
      });
    });

    it('returns null when either time is invalid', () => {
      expect(toMinuteRange({ startTime: '25:00', endTime: '10:30' })).toBeNull();
      expect(toMinuteRange({ startTime: '09:00' })).toBeNull();
    });

    it('needs a positive length', () => {
      expect(isValidRange({ start: 540, end: 541 })).toBe(true);
      expect(isValidRange({ start: 540, end: 540 })).toBe(false);
      expect(isValidRange({ start: 600, end: 540 })).toBe(false);
      expect(isValidRange(null)).toBe(false);
    });
  });

  describe('rangesOverlap (half-open)', () => {
    const r = (start, end) => ({ start, end });

    it.each([
      [r(0, 60), r(30, 90), true],
      [r(30, 90), r(0, 60), true],
      [r(0, 120), r(30, 60), true],
      [r(30, 60), r(0, 120), true],
      [r(0, 60), r(0, 60), true],
      [r(0, 60), r(60, 120), false],
      [r(60, 120), r(0, 60), false],
      [r(0, 60), r(90, 120), false],
    ])('%j vs %j -> %s', (a, b, expected) => {
      expect(rangesOverlap(a, b)).toBe(expected);
    });
  });

  describe('rangeContains', () => {
    const outer = { start: 540, end: 720 };

    it.each([
      [{ start: 540, end: 720 }, true],
      [{ start: 600, end: 660 }, true],
      [{ start: 540, end: 541 }, true],
      [{ start: 539, end: 600 }, false],
      [{ start: 600, end: 721 }, false],
      [{ start: 500, end: 800 }, false],
      [{ start: 720, end: 780 }, false],
    ])('%j inside 09:00-12:00 -> %s', (inner, expected) => {
      expect(rangeContains(outer, inner)).toBe(expected);
    });
  });

  describe('findOverlappingPair', () => {
    it('returns null for no ranges, one range, disjoint and touching ranges', () => {
      expect(findOverlappingPair([])).toBeNull();
      expect(findOverlappingPair([{ start: 0, end: 60 }])).toBeNull();
      expect(
        findOverlappingPair([
          { start: 0, end: 60 },
          { start: 90, end: 120 },
        ]),
      ).toBeNull();
      expect(
        findOverlappingPair([
          { start: 0, end: 60 },
          { start: 60, end: 120 },
        ]),
      ).toBeNull();
    });

    it('finds an overlap and reports input indexes, earlier-starting range first', () => {
      expect(
        findOverlappingPair([
          { start: 100, end: 200 },
          { start: 0, end: 50 },
          { start: 150, end: 250 },
        ]),
      ).toEqual([0, 2]);
    });

    it('finds a range swallowed by a long one', () => {
      expect(
        findOverlappingPair([
          { start: 0, end: 600 },
          { start: 100, end: 200 },
          { start: 700, end: 800 },
        ]),
      ).toEqual([0, 1]);
    });

    it('does not mutate the input', () => {
      const input = [
        { start: 100, end: 200 },
        { start: 0, end: 50 },
      ];
      findOverlappingPair(input);
      expect(input).toEqual([
        { start: 100, end: 200 },
        { start: 0, end: 50 },
      ]);
    });
  });

  describe('mergeRanges', () => {
    it('merges overlapping and touching ranges and sorts the result', () => {
      expect(
        mergeRanges([
          { start: 720, end: 900 },
          { start: 540, end: 720 },
          { start: 1000, end: 1100 },
          { start: 1050, end: 1200 },
        ]),
      ).toEqual([
        { start: 540, end: 900 },
        { start: 1000, end: 1200 },
      ]);
    });

    it('keeps the larger end when one range contains another', () => {
      expect(
        mergeRanges([
          { start: 0, end: 600 },
          { start: 100, end: 200 },
        ]),
      ).toEqual([{ start: 0, end: 600 }]);
    });

    it('returns [] for no ranges and does not mutate the input', () => {
      expect(mergeRanges([])).toEqual([]);
      const input = [
        { start: 60, end: 120 },
        { start: 0, end: 60 },
      ];
      mergeRanges(input);
      expect(input).toEqual([
        { start: 60, end: 120 },
        { start: 0, end: 60 },
      ]);
    });
  });

  describe('facilityDateRangeToUtc / facilityDayToUtc', () => {
    it('maps inclusive Asia/Dubai dates (UTC+4) to a half-open UTC window', () => {
      const { start, end } = facilityDateRangeToUtc('2026-11-10', '2026-11-12', 'Asia/Dubai');
      expect(start.toISOString()).toBe('2026-11-09T20:00:00.000Z');
      expect(end.toISOString()).toBe('2026-11-12T20:00:00.000Z');
    });

    it('uses Asia/Dubai when no timezone is passed', () => {
      const { start, end } = facilityDayToUtc('2026-11-10');
      expect(start.toISOString()).toBe('2026-11-09T20:00:00.000Z');
      expect(end.toISOString()).toBe('2026-11-10T20:00:00.000Z');
    });

    it('a single day is 24 hours long in a zone without DST', () => {
      const { start, end } = facilityDayToUtc('2026-03-29', 'Asia/Dubai');
      expect(end - start).toBe(24 * 60 * 60 * 1000);
    });

    it('crosses month and year ends', () => {
      const { start, end } = facilityDateRangeToUtc('2026-12-31', '2026-12-31', 'Asia/Dubai');
      expect(start.toISOString()).toBe('2026-12-30T20:00:00.000Z');
      expect(end.toISOString()).toBe('2026-12-31T20:00:00.000Z');
    });

    it('handles a DST change inside the range (America/New_York, DST ends 2026-11-01)', () => {
      const { start, end } = facilityDateRangeToUtc('2026-10-31', '2026-11-01', 'America/New_York');
      expect(start.toISOString()).toBe('2026-10-31T04:00:00.000Z'); // EDT, UTC-4
      expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST, UTC-5
      expect(end - start).toBe(49 * 60 * 60 * 1000);
    });

    it('treats consecutive days as touching windows', () => {
      const first = facilityDayToUtc('2026-11-10', 'Asia/Dubai');
      const second = facilityDayToUtc('2026-11-11', 'Asia/Dubai');
      expect(first.end.getTime()).toBe(second.start.getTime());
    });
  });
});
