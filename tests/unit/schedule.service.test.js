const {
  localDateTimeToUtc,
  getTodayInTimezone,
  addDaysToDateStr,
  // Re-exported from timezone.util for schedule callers.
  getIsoDayOfWeek,
} = require('../../src/services/schedule.service');

describe('Schedule Service Unit Tests', () => {
  describe('Timezone & Date Math', () => {
    it('converts Asia/Dubai local time to correct UTC (UTC+4)', () => {
      // 09:00 in Dubai is 05:00 UTC
      const utc = localDateTimeToUtc('2026-11-01', '09:00', 'Asia/Dubai');
      expect(utc.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    });

    it('correctly handles America/New_York DST transition boundaries', () => {
      // EDT (Summer Daylight Time, UTC-4): 09:00 NY is 13:00 UTC
      const summerUtc = localDateTimeToUtc('2026-07-01', '09:00', 'America/New_York');
      expect(summerUtc.toISOString()).toBe('2026-07-01T13:00:00.000Z');

      // EST (Winter Standard Time, UTC-5): 09:00 NY is 14:00 UTC
      const winterUtc = localDateTimeToUtc('2026-01-15', '09:00', 'America/New_York');
      expect(winterUtc.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    });

    it('correctly handles Europe/London DST transition boundaries', () => {
      // BST (Summer, UTC+1): 10:00 London is 09:00 UTC
      const summerUtc = localDateTimeToUtc('2026-06-01', '10:00', 'Europe/London');
      expect(summerUtc.toISOString()).toBe('2026-06-01T09:00:00.000Z');

      // GMT (Winter, UTC+0): 10:00 London is 10:00 UTC
      const winterUtc = localDateTimeToUtc('2026-12-01', '10:00', 'Europe/London');
      expect(winterUtc.toISOString()).toBe('2026-12-01T10:00:00.000Z');
    });

    it('computes ISO day of week correctly (1=Monday ... 7=Sunday)', () => {
      // 2026-10-26 is Monday
      expect(getIsoDayOfWeek('2026-10-26')).toBe(1);
      // 2026-10-27 is Tuesday
      expect(getIsoDayOfWeek('2026-10-27')).toBe(2);
      // 2026-11-01 is Sunday
      expect(getIsoDayOfWeek('2026-11-01')).toBe(7);
    });

    it('adds days across month and year boundaries correctly', () => {
      expect(addDaysToDateStr('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDaysToDateStr('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('returns today as YYYY-MM-DD in specified timezone', () => {
      const todayDubai = getTodayInTimezone('Asia/Dubai');
      expect(todayDubai).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
