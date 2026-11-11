const {
  checkAvailability,
  checkLeave,
  checkSessions,
  checkAppointments,
  findFirstConflict,
} = require('../../src/services/coachSchedule.rules');
const { CoachConflictType: T, ConflictItemKind: K } = require('../../src/constants/coachConflict');

const TZ = 'Asia/Dubai';
const D = '2026-12-01'; // a Tuesday (ISO weekday 2)

// Facility wall-clock (Dubai, UTC+4) -> Date.
const at = (hhmm, date = D) => new Date(`${date}T${hhmm}:00+04:00`);
const range = (from, to) => ({ start: from * 60, end: to * 60 }); // hours -> minutes
const day = (ranges, isAvailable = true) => ({ isAvailable, ranges });

const NINE_TO_TWELVE_AND_TWELVE_TO_THREE = day([range(9, 12), range(12, 15)]);

describe('checkAvailability', () => {
  const run = (from, to, d) =>
    checkAvailability({ startAt: at(from), endAt: at(to), timezone: TZ, day: d });

  it('fits fully inside one slot (also touching its bounds)', () => {
    const d = day([range(9, 12)]);
    expect(run('10:00', '11:00', d)).toBeNull();
    expect(run('09:00', '12:00', d)).toBeNull();
  });

  it('merges touching slots, so an interval across the join fits', () => {
    expect(run('11:00', '13:00', NINE_TO_TWELVE_AND_TWELVE_TO_THREE)).toBeNull();
    expect(run('09:00', '15:00', NINE_TO_TWELVE_AND_TWELVE_TO_THREE)).toBeNull();
  });

  it('does not merge slots with a gap: an interval across the gap is OUTSIDE', () => {
    const d = day([range(9, 12), range(13, 15)]);
    expect(run('11:00', '14:00', d)).toMatchObject({ type: T.OUTSIDE_AVAILABILITY });
    expect(run('13:00', '14:00', d)).toBeNull();
  });

  it('starting before or ending after the slot is OUTSIDE_AVAILABILITY with no item', () => {
    const d = day([range(9, 12)]);
    expect(run('08:59', '10:00', d)).toEqual(
      expect.objectContaining({ type: T.OUTSIDE_AVAILABILITY, conflictingItem: null }),
    );
    expect(run('11:00', '12:01', d).type).toBe(T.OUTSIDE_AVAILABILITY);
  });

  it('no saved row, or an available day without ranges, is AVAILABILITY_NOT_SET', () => {
    expect(run('10:00', '11:00', null)).toMatchObject({
      type: T.AVAILABILITY_NOT_SET,
      conflictingItem: null,
    });
    expect(run('10:00', '11:00', undefined).type).toBe(T.AVAILABILITY_NOT_SET);
    expect(run('10:00', '11:00', day([])).type).toBe(T.AVAILABILITY_NOT_SET);
  });

  it('a saved day off (isAvailable = false) is OUTSIDE_AVAILABILITY', () => {
    expect(run('10:00', '11:00', day([], false)).type).toBe(T.OUTSIDE_AVAILABILITY);
    expect(run('10:00', '11:00', day([range(9, 12)], false)).type).toBe(T.OUTSIDE_AVAILABILITY);
  });

  it('an interval that crosses midnight is OUTSIDE_AVAILABILITY, even ending exactly at midnight', () => {
    const allDay = day([{ start: 0, end: 23 * 60 + 59 }]);
    const crossing = checkAvailability({
      startAt: at('23:00'),
      endAt: at('01:00', '2026-12-02'),
      timezone: TZ,
      day: allDay,
    });
    expect(crossing.type).toBe(T.OUTSIDE_AVAILABILITY);
    const toMidnight = checkAvailability({
      startAt: at('23:00'),
      endAt: at('00:00', '2026-12-02'),
      timezone: TZ,
      day: allDay,
    });
    expect(toMidnight.type).toBe(T.OUTSIDE_AVAILABILITY);
  });

  it('uses the FACILITY day: 22:00 UTC is already the next day in Dubai', () => {
    const result = checkAvailability({
      startAt: new Date('2026-12-01T22:00:00Z'), // 02:00 on 2 Dec in Dubai
      endAt: new Date('2026-12-01T23:00:00Z'),
      timezone: TZ,
      day: day([range(1, 3)]),
    });
    expect(result).toBeNull();
  });

  it('puts the weekday and the local times in the message', () => {
    expect(run('08:00', '09:30', day([range(10, 12)])).message).toBe(
      "08:00-09:30 is outside the coach's available hours on Tuesday",
    );
  });
});

describe('checkLeave', () => {
  const leave = (startDate, endDate, id = 'leave-1') => ({ id, startDate, endDate });
  const run = (from, to, leaves, fromDate = D, toDate = D) =>
    checkLeave({ startAt: at(from, fromDate), endAt: at(to, toDate), timezone: TZ, leaves });

  it('a leave day blocks the whole facility day (inclusive first and last dates)', () => {
    const l = [leave('2026-12-01', '2026-12-03')];
    expect(run('00:00', '01:00', l)).toMatchObject({ type: T.COACH_UNAVAILABLE });
    expect(run('23:00', '23:59', l, '2026-12-03', '2026-12-03')).toMatchObject({
      type: T.COACH_UNAVAILABLE,
    });
  });

  it('the day before and the day after are free', () => {
    const l = [leave('2026-12-02', '2026-12-02')];
    expect(run('10:00', '11:00', l, '2026-12-01', '2026-12-01')).toBeNull();
    expect(run('10:00', '11:00', l, '2026-12-03', '2026-12-03')).toBeNull();
  });

  it('an interval ending exactly at midnight does not touch the next day', () => {
    const l = [leave('2026-12-02', '2026-12-02')];
    expect(run('23:00', '00:00', l, '2026-12-01', '2026-12-02')).toBeNull();
    expect(run('23:00', '00:30', l, '2026-12-01', '2026-12-02').type).toBe(T.COACH_UNAVAILABLE);
  });

  it('reports the leave as the item with ISO UTC bounds of its days', () => {
    const result = run('10:00', '11:00', [leave('2026-12-01', '2026-12-02', 'L9')]);
    expect(result.conflictingItem).toEqual({
      kind: K.LEAVE,
      id: 'L9',
      startAt: '2026-11-30T20:00:00.000Z',
      endAt: '2026-12-02T20:00:00.000Z',
    });
    expect(result.message).toBe('The coach is on leave from 2026-12-01 to 2026-12-02');
  });

  it('no leave, no conflict', () => {
    expect(run('10:00', '11:00', [])).toBeNull();
  });
});

describe('checkSessions', () => {
  const session = (id, from, to) => ({ id, startAt: at(from), endAt: at(to) });
  const run = (from, to, sessions) => checkSessions({ startAt: at(from), endAt: at(to), sessions });

  it('an overlapping session is SESSION_OVERLAP with the session as item', () => {
    const result = run('10:00', '11:00', [session('s1', '10:30', '11:30')]);
    expect(result).toMatchObject({
      type: T.SESSION_OVERLAP,
      conflictingItem: {
        kind: K.SESSION,
        id: 's1',
        startAt: at('10:30').toISOString(),
        endAt: at('11:30').toISOString(),
      },
    });
  });

  it('touching is fine in both directions (raw time only)', () => {
    expect(run('10:00', '11:00', [session('s1', '09:00', '10:00')])).toBeNull();
    expect(run('10:00', '11:00', [session('s1', '11:00', '12:00')])).toBeNull();
  });

  it('a session containing or contained by the interval overlaps', () => {
    expect(run('10:00', '11:00', [session('s1', '09:00', '12:00')]).type).toBe(T.SESSION_OVERLAP);
    expect(run('09:00', '12:00', [session('s1', '10:00', '11:00')]).type).toBe(T.SESSION_OVERLAP);
  });

  it('reports the earliest clashing session', () => {
    const result = run('09:00', '12:00', [
      session('late', '11:00', '11:30'),
      session('early', '09:30', '10:00'),
    ]);
    expect(result.conflictingItem.id).toBe('early');
  });
});

describe('checkAppointments', () => {
  const appt = (id, from, to, before = 0, after = 0) => ({
    id,
    startAt: at(from),
    endAt: at(to),
    bufferBeforeMin: before,
    bufferAfterMin: after,
  });
  const run = (from, to, appointments, before = 0, after = 0) =>
    checkAppointments({
      startAt: at(from),
      endAt: at(to),
      bufferBeforeMin: before,
      bufferAfterMin: after,
      appointments,
    });

  it('raw overlap is APPOINTMENT_OVERLAP with the appointment as item', () => {
    const result = run('10:00', '11:00', [appt('a1', '10:30', '11:30')]);
    expect(result).toMatchObject({
      type: T.APPOINTMENT_OVERLAP,
      conflictingItem: { kind: K.APPOINTMENT, id: 'a1' },
    });
  });

  it('touching with no buffers is fine', () => {
    expect(run('10:00', '11:00', [appt('a1', '09:00', '10:00')])).toBeNull();
    expect(run('10:00', '11:00', [appt('a1', '11:00', '12:00')])).toBeNull();
  });

  it("an existing appointment's AFTER buffer blocks a following start: APPOINTMENT_BUFFER", () => {
    const existing = appt('a1', '09:00', '10:00', 0, 15);
    expect(run('10:10', '11:00', [existing])).toMatchObject({
      type: T.APPOINTMENT_BUFFER,
      conflictingItem: { id: 'a1' },
    });
    expect(run('10:15', '11:00', [existing])).toBeNull(); // buffer ends exactly at 10:15
  });

  it("an existing appointment's BEFORE buffer blocks a preceding end", () => {
    const existing = appt('a1', '11:00', '12:00', 20, 0);
    expect(run('10:00', '10:45', [existing]).type).toBe(T.APPOINTMENT_BUFFER);
    expect(run('10:00', '10:40', [existing])).toBeNull();
  });

  it("the new item's OWN buffers extend its footprint too", () => {
    const existing = appt('a1', '11:00', '12:00');
    expect(run('10:00', '10:50', [existing], 0, 15).type).toBe(T.APPOINTMENT_BUFFER);
    expect(run('10:00', '10:45', [existing], 0, 15)).toBeNull();
    const before = appt('a2', '09:00', '10:00');
    expect(run('10:05', '11:00', [before], 10, 0).type).toBe(T.APPOINTMENT_BUFFER);
  });

  it('both buffers count together (the two buffered windows must not overlap)', () => {
    const existing = appt('a1', '09:00', '10:00', 0, 10);
    expect(run('10:10', '11:00', [existing], 5, 0).type).toBe(T.APPOINTMENT_BUFFER);
    expect(run('10:15', '11:00', [existing], 5, 0)).toBeNull();
  });

  it('prefers a raw overlap over an earlier buffer-only clash', () => {
    const result = run('10:00', '11:00', [
      appt('buffer', '09:00', '09:55', 0, 10),
      appt('raw', '10:30', '11:30'),
    ]);
    expect(result).toMatchObject({
      type: T.APPOINTMENT_OVERLAP,
      conflictingItem: { id: 'raw' },
    });
  });

  it('no appointments, no conflict', () => {
    expect(run('10:00', '11:00', [])).toBeNull();
  });
});

describe('findFirstConflict (order of the rules)', () => {
  const base = {
    coachId: 'c1',
    startAt: at('10:00'),
    endAt: at('11:00'),
    timezone: TZ,
    day: day([range(9, 12)]),
    leaves: [],
    sessions: [],
    appointments: [],
  };
  const everythingWrong = {
    ...base,
    day: null,
    leaves: [{ id: 'l1', startDate: D, endDate: D }],
    sessions: [{ id: 's1', startAt: at('10:00'), endAt: at('11:00') }],
    appointments: [
      { id: 'a1', startAt: at('10:00'), endAt: at('11:00'), bufferBeforeMin: 0, bufferAfterMin: 0 },
    ],
  };

  it('a free coach returns null', () => {
    expect(findFirstConflict(base)).toBeNull();
  });

  it('adds the coach id', () => {
    expect(findFirstConflict({ ...base, day: null })).toMatchObject({
      coachId: 'c1',
      type: T.AVAILABILITY_NOT_SET,
    });
  });

  it('availability beats leave, sessions and appointments', () => {
    expect(findFirstConflict(everythingWrong).type).toBe(T.AVAILABILITY_NOT_SET);
  });

  it('then leave beats sessions and appointments', () => {
    expect(findFirstConflict({ ...everythingWrong, day: base.day }).type).toBe(T.COACH_UNAVAILABLE);
  });

  it('then sessions beat appointments', () => {
    expect(findFirstConflict({ ...everythingWrong, day: base.day, leaves: [] }).type).toBe(
      T.SESSION_OVERLAP,
    );
  });

  it('appointments come last', () => {
    expect(
      findFirstConflict({ ...everythingWrong, day: base.day, leaves: [], sessions: [] }).type,
    ).toBe(T.APPOINTMENT_OVERLAP);
  });
});
