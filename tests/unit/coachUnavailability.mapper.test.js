const {
  toDateString,
  toUnavailabilityResponse,
  toAffectedSessionResponse,
  toUnavailabilityWithImpact,
} = require('../../src/repositories/coachUnavailability.mapper');

const row = (overrides = {}) => ({
  id: '7e7e7e7e-0000-4000-8000-000000000009',
  coachId: '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f',
  startDate: new Date('2026-12-01T00:00:00.000Z'),
  endDate: new Date('2026-12-05T00:00:00.000Z'),
  reason: 'Sick leave',
  note: null,
  createdAt: new Date('2026-11-11T08:00:00.000Z'),
  updatedAt: new Date('2026-11-11T09:30:15.000Z'),
  ...overrides,
});

describe('coachUnavailability.mapper', () => {
  it('formats a @db.Date value as YYYY-MM-DD', () => {
    expect(toDateString(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });

  it('returns dates as YYYY-MM-DD and timestamps as ISO 8601 UTC', () => {
    expect(toUnavailabilityResponse(row())).toEqual({
      id: '7e7e7e7e-0000-4000-8000-000000000009',
      coachId: '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      reason: 'Sick leave',
      note: null,
      createdAt: '2026-11-11T08:00:00.000Z',
      updatedAt: '2026-11-11T09:30:15.000Z',
    });
  });

  it('keeps note as an explicit null (never omitted) and as text when set', () => {
    expect(toUnavailabilityResponse(row({ note: null }))).toHaveProperty('note', null);
    expect(toUnavailabilityResponse(row({ note: undefined }))).toHaveProperty('note', null);
    expect(toUnavailabilityResponse(row({ note: 'flu' })).note).toBe('flu');
  });

  it('has exactly the documented keys', () => {
    expect(Object.keys(toUnavailabilityResponse(row())).sort()).toEqual(
      ['coachId', 'createdAt', 'endDate', 'id', 'note', 'reason', 'startDate', 'updatedAt'].sort(),
    );
  });

  it('maps an affected session with the class name as title and ISO UTC times', () => {
    const session = {
      id: 'session-1',
      classId: 'class-1',
      startAt: new Date('2026-12-02T06:00:00.000Z'),
      endAt: new Date('2026-12-02T07:00:00.000Z'),
      class: { name: 'Morning Burn' },
      coaches: [{ coachId: 'x' }],
    };
    expect(toAffectedSessionResponse(session, 'UNCOVERED')).toEqual({
      sessionId: 'session-1',
      classId: 'class-1',
      title: 'Morning Burn',
      startAt: '2026-12-02T06:00:00.000Z',
      endAt: '2026-12-02T07:00:00.000Z',
      coverage: 'UNCOVERED',
    });
  });

  it('adds affectedSessions and affectedTotal to the leave, flat', () => {
    const result = toUnavailabilityWithImpact(row(), { affectedSessions: [], affectedTotal: 0 });
    expect(result.affectedSessions).toEqual([]);
    expect(result.affectedTotal).toBe(0);
    expect(result.startDate).toBe('2026-12-01');
  });
});
