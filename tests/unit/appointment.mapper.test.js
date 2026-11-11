const { toAppointmentResponse } = require('../../src/repositories/appointment.mapper');
const { toAppointmentTypeResponse } = require('../../src/repositories/appointmentType.mapper');

const at = (iso) => new Date(iso);

describe('toAppointmentTypeResponse', () => {
  it('returns the fields with ISO 8601 UTC timestamps', () => {
    const row = {
      id: 't1',
      name: 'PT 60',
      durationMin: 60,
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      isActive: true,
      createdAt: at('2026-11-01T08:00:00Z'),
      updatedAt: at('2026-11-02T08:00:00Z'),
      extra: 'dropped',
    };
    expect(toAppointmentTypeResponse(row)).toEqual({
      id: 't1',
      name: 'PT 60',
      durationMin: 60,
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      isActive: true,
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-02T08:00:00.000Z',
    });
  });
});

describe('toAppointmentResponse', () => {
  const row = {
    id: 'a1',
    coachId: 'c1',
    memberId: 'm1',
    appointmentTypeId: 't1',
    startAt: at('2026-12-01T06:00:00Z'),
    endAt: at('2026-12-01T07:00:00Z'),
    bufferBeforeMin: 5,
    bufferAfterMin: 10,
    state: 'BOOKED',
    cancelledAt: null,
    version: 1,
    createdAt: at('2026-11-11T08:00:00Z'),
    updatedAt: at('2026-11-11T08:00:00Z'),
    coach: { user: { fullName: 'Coach One' } },
    member: { fullName: 'Member One' },
    appointmentType: { name: 'PT 60' },
  };

  it('flattens the names, uses ISO UTC strings and an explicit null cancelledAt', () => {
    expect(toAppointmentResponse(row)).toEqual({
      id: 'a1',
      coachId: 'c1',
      coachName: 'Coach One',
      memberId: 'm1',
      memberName: 'Member One',
      appointmentTypeId: 't1',
      appointmentTypeName: 'PT 60',
      startAt: '2026-12-01T06:00:00.000Z',
      endAt: '2026-12-01T07:00:00.000Z',
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      state: 'BOOKED',
      cancelledAt: null,
      version: 1,
      createdAt: '2026-11-11T08:00:00.000Z',
      updatedAt: '2026-11-11T08:00:00.000Z',
    });
  });

  it('formats cancelledAt and falls back to null names', () => {
    const out = toAppointmentResponse({
      ...row,
      state: 'CANCELLED',
      cancelledAt: at('2026-11-12T08:00:00Z'),
      coach: undefined,
      member: undefined,
      appointmentType: undefined,
    });
    expect(out.cancelledAt).toBe('2026-11-12T08:00:00.000Z');
    expect([out.coachName, out.memberName, out.appointmentTypeName]).toEqual([null, null, null]);
  });
});
