const { toWeeklyAvailabilityResponse } = require('../../src/repositories/coachAvailability.mapper');

const COACH_ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00.000Z`);

const row = (
  dayOfWeek,
  slots,
  { isAvailable = true, updatedAt = '2026-11-11T08:00:00.000Z' } = {},
) => ({
  dayOfWeek,
  isAvailable,
  updatedAt: new Date(updatedAt),
  slots: slots.map(([startTime, endTime]) => ({
    startTime: time(startTime),
    endTime: time(endTime),
  })),
});

const view = (rows) =>
  toWeeklyAvailabilityResponse({ coachId: COACH_ID, rows, timezone: 'Asia/Dubai' });

describe('coachAvailability.mapper', () => {
  it('returns 7 unavailable days, isConfigured false and updatedAt null when nothing was saved', () => {
    const result = view([]);
    expect(result).toEqual({
      coachId: COACH_ID,
      timezone: 'Asia/Dubai',
      isConfigured: false,
      updatedAt: null,
      days: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        dayOfWeek,
        isAvailable: false,
        slots: [],
      })),
    });
  });

  it('always lists the days in dayOfWeek order 1..7, whatever order the rows come in', () => {
    const result = view([row(5, [['06:00', '09:00']]), row(2, [['10:00', '11:00']])]);
    expect(result.days.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.days[1].slots).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
    expect(result.days[4].slots).toEqual([{ startTime: '06:00', endTime: '09:00' }]);
  });

  it('fills a weekday without a row as unavailable with no slots', () => {
    const result = view([row(1, [['06:00', '09:00']])]);
    expect(result.days[2]).toEqual({ dayOfWeek: 3, isAvailable: false, slots: [] });
    expect(result.isConfigured).toBe(true);
  });

  it('keeps a saved unavailable day unavailable and counts it as configured', () => {
    const result = view([row(1, [], { isAvailable: false })]);
    expect(result.isConfigured).toBe(true);
    expect(result.days[0]).toEqual({ dayOfWeek: 1, isAvailable: false, slots: [] });
  });

  it('formats times as HH:mm strings (zero padded, no seconds)', () => {
    const result = view([
      row(1, [
        ['00:05', '09:30'],
        ['23:00', '23:59'],
      ]),
    ]);
    expect(result.days[0].slots).toEqual([
      { startTime: '00:05', endTime: '09:30' },
      { startTime: '23:00', endTime: '23:59' },
    ]);
  });

  it('reports the latest updatedAt as an ISO 8601 UTC string', () => {
    const result = view([
      row(1, [['06:00', '09:00']], { updatedAt: '2026-11-10T08:00:00.000Z' }),
      row(2, [['06:00', '09:00']], { updatedAt: '2026-11-11T09:30:15.000Z' }),
    ]);
    expect(result.updatedAt).toBe('2026-11-11T09:30:15.000Z');
  });

  it('has exactly the documented keys, with explicit nulls (never omitted)', () => {
    expect(Object.keys(view([])).sort()).toEqual(
      ['coachId', 'days', 'isConfigured', 'timezone', 'updatedAt'].sort(),
    );
    expect(view([]).updatedAt).toBeNull();
  });
});
