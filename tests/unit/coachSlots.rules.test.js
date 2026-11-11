const { buildOpenSlots, subtractBlockers, cutGap } = require('../../src/services/coachSlots.rules');

const TZ = 'Asia/Dubai';
const D = '2026-12-01'; // Tuesday = ISO weekday 2
const at = (hhmm, date = D) => new Date(`${date}T${hhmm}:00+04:00`);
const hours = (from, to) => ({ start: from * 60, end: to * 60 });
const EARLY = new Date('2026-11-01T00:00:00Z'); // "now" long before the test day

const week = (ranges, isAvailable = true) => new Map([[2, { isAvailable, ranges }]]);

const run = (overrides = {}) =>
  buildOpenSlots({
    coachId: 'c1',
    dates: [D],
    timezone: TZ,
    durationMin: 60,
    now: EARLY,
    week: week([hours(9, 13)]),
    ...overrides,
  });

// Dubai wall-clock text of every slot of the first day: 'HH:mm-HH:mm'.
const dubai = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
const texts = (result, index = 0) =>
  result[index].slots.map((s) => `${dubai(s.startAt)}-${dubai(s.endAt)}`);

describe('buildOpenSlots', () => {
  it('09:00-13:00 with a 60-minute type gives 4 back-to-back slots', () => {
    expect(texts(run())).toEqual(['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00']);
  });

  it('step = duration: a 45-minute type drops the remainder that does not fit', () => {
    expect(texts(run({ durationMin: 45 }))).toEqual([
      '09:00-09:45',
      '09:45-10:30',
      '10:30-11:15',
      '11:15-12:00',
      '12:00-12:45',
    ]);
  });

  it('returns every date of the range, with an empty array when nothing is free', () => {
    const result = run({ dates: [D, '2026-12-02', '2026-12-03'] }); // only Tuesday has hours
    expect(result.map((r) => r.date)).toEqual([D, '2026-12-02', '2026-12-03']);
    expect(result[0].slots).toHaveLength(4);
    expect(result[1].slots).toEqual([]);
    expect(result[2].slots).toEqual([]);
  });

  it('a leave day gives no slots (inclusive first and last day), the next day is free', () => {
    const leaves = [{ id: 'l1', startDate: '2026-11-30', endDate: D }];
    expect(run({ leaves })[0].slots).toEqual([]);
    const nextWeek = new Map([
      [2, { isAvailable: true, ranges: [hours(9, 11)] }],
      [3, { isAvailable: true, ranges: [hours(9, 11)] }],
    ]);
    const two = run({ dates: [D, '2026-12-02'], leaves, week: nextWeek });
    expect(two[0].slots).toEqual([]);
    expect(two[1].slots).toHaveLength(2);
  });

  it('a class session in the middle splits the day (raw time only)', () => {
    const sessions = [{ id: 's1', startAt: at('10:30'), endAt: at('11:30') }];
    expect(texts(run({ sessions }))).toEqual(['09:00-10:00', '11:30-12:30']);
  });

  it('a session touching a slot edge does not remove it', () => {
    const sessions = [{ id: 's1', startAt: at('10:00'), endAt: at('11:00') }];
    expect(texts(run({ sessions }))).toEqual(['09:00-10:00', '11:00-12:00', '12:00-13:00']);
  });

  it('the buffers of an existing appointment remove the neighbouring slots', () => {
    const appointments = [
      {
        id: 'a1',
        startAt: at('11:00'),
        endAt: at('12:00'),
        bufferBeforeMin: 30,
        bufferAfterMin: 30,
      },
    ];
    // blocked 10:30-12:30 -> 09:00-10:30 gives one slot, 12:30-13:00 is too short
    expect(texts(run({ appointments }))).toEqual(['09:00-10:00']);
  });

  it("the new appointment's own buffers are respected as well", () => {
    const appointments = [
      { id: 'a1', startAt: at('11:00'), endAt: at('12:00'), bufferBeforeMin: 0, bufferAfterMin: 0 },
    ];
    // own buffers 15 / 15: blocked from 10:45 to 12:15, gaps 09:00-10:45 and 12:15-13:00
    const slots = texts(run({ appointments, bufferBeforeMin: 15, bufferAfterMin: 15 }));
    expect(slots).toEqual(['09:00-10:00']);
    // without own buffers the neighbours are free
    expect(texts(run({ appointments }))).toEqual(['09:00-10:00', '10:00-11:00', '12:00-13:00']);
  });

  it('every returned slot passes the S7 rules (a slot never touches a buffered neighbour)', () => {
    const appointments = [
      {
        id: 'a1',
        startAt: at('10:00'),
        endAt: at('11:00'),
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      },
    ];
    const slots = run({ appointments, bufferBeforeMin: 5, bufferAfterMin: 10 })[0].slots;
    slots.forEach((slot) => {
      const clearBefore = slot.endAt.getTime() + 10 * 60000 <= at('10:00').getTime() - 5 * 60000;
      const clearAfter = slot.startAt.getTime() - 5 * 60000 >= at('11:00').getTime() + 10 * 60000;
      expect(clearBefore || clearAfter).toBe(true);
    });
  });

  it('touching saved slots are merged: a slot may span the join', () => {
    const touching = week([hours(9, 12), hours(12, 15)]);
    expect(texts(run({ week: touching, durationMin: 90 }))).toEqual([
      '09:00-10:30',
      '10:30-12:00',
      '12:00-13:30',
      '13:30-15:00',
    ]);
    expect(texts(run({ week: touching, durationMin: 120 }))).toEqual([
      '09:00-11:00',
      '11:00-13:00',
      '13:00-15:00',
    ]);
  });

  it('a gap between saved slots is not bridged', () => {
    expect(texts(run({ week: week([hours(9, 10), hours(11, 12)]), durationMin: 90 }))).toEqual([]);
  });

  it('past times are never returned: a slot must start after now', () => {
    expect(texts(run({ now: at('10:30') }))).toEqual(['11:00-12:00', '12:00-13:00']);
    // exactly at the start is already "now": not returned (booking would be refused)
    expect(texts(run({ now: at('10:00') }))).toEqual(['11:00-12:00', '12:00-13:00']);
    expect(run({ now: at('13:00') })[0].slots).toEqual([]);
  });

  it('keeps the grid of the gap when "now" falls inside it', () => {
    expect(texts(run({ now: at('09:20') }))).toEqual(['10:00-11:00', '11:00-12:00', '12:00-13:00']);
  });

  it('day-end edge (no DST in Asia/Dubai): 22:00-23:59 gives one slot, the last minutes stay unused', () => {
    expect(texts(run({ week: week([{ start: 22 * 60, end: 23 * 60 + 59 }]) }))).toEqual([
      '22:00-23:00',
    ]);
    expect(
      texts(run({ week: week([{ start: 23 * 60, end: 23 * 60 + 59 }]), durationMin: 30 })),
    ).toEqual(['23:00-23:30']);
  });

  it('a slot is never returned across midnight (the grid stops at the saved range end)', () => {
    const slots = run({ week: week([{ start: 0, end: 23 * 60 + 59 }]), durationMin: 60 })[0].slots;
    expect(slots).toHaveLength(23); // 00:00 ... 22:00
    expect(dubai(slots[slots.length - 1].endAt)).toBe('23:00');
  });

  it('no saved row, a saved day off, or an available day with no ranges gives nothing', () => {
    expect(run({ week: new Map() })[0].slots).toEqual([]);
    expect(run({ week: week([hours(9, 13)], false) })[0].slots).toEqual([]);
    expect(run({ week: week([]) })[0].slots).toEqual([]);
  });

  it('returns Dates in UTC order', () => {
    const slots = run()[0].slots;
    expect(slots[0].startAt).toEqual(new Date('2026-12-01T05:00:00.000Z'));
    expect(slots.map((s) => s.startAt.getTime())).toEqual(
      [...slots].map((s) => s.startAt.getTime()).sort((a, b) => a - b),
    );
  });

  it('ignores sessions and appointments of other days', () => {
    const sessions = [
      { id: 's1', startAt: at('10:00', '2026-12-02'), endAt: at('11:00', '2026-12-02') },
    ];
    expect(run({ sessions })[0].slots).toHaveLength(4);
  });
});

describe('subtractBlockers / cutGap', () => {
  it('subtractBlockers keeps the free parts, merging overlapping blockers', () => {
    expect(
      subtractBlockers(0, 100, [
        { start: 10, end: 30 },
        { start: 20, end: 40 },
        { start: 90, end: 120 },
      ]),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 40, end: 90 },
    ]);
    expect(subtractBlockers(0, 100, [{ start: -10, end: 200 }])).toEqual([]);
    expect(subtractBlockers(0, 100, [])).toEqual([{ start: 0, end: 100 }]);
  });

  it('cutGap steps by the duration and drops the remainder', () => {
    expect(cutGap({ start: 0, end: 100 }, 30)).toEqual([
      { start: 0, end: 30 },
      { start: 30, end: 60 },
      { start: 60, end: 90 },
    ]);
    expect(cutGap({ start: 0, end: 20 }, 30)).toEqual([]);
  });
});
