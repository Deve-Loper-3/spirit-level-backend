const {
  createAppointmentTypeBodySchema: createType,
  updateAppointmentTypeBodySchema: updateType,
  listAppointmentTypesQuerySchema: listTypes,
  appointmentTypeParamsSchema: typeParams,
  createAppointmentBodySchema: createAppointment,
  listAppointmentsQuerySchema: listAppointments,
  appointmentParamsSchema: appointmentParams,
} = require('../../src/validators/appointment.validation');
const { Messages } = require('../../src/constants/messages');

const ID = '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f';
const issues = (result) => result.error.issues.map((i) => [i.path.join('.'), i.message]);

describe('create appointment type body', () => {
  it('trims the name and applies the defaults', () => {
    const result = createType.safeParse({ name: '  PT 60  ', durationMin: 60 });
    expect(result.data).toEqual({
      name: 'PT 60',
      durationMin: 60,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      isActive: true,
    });
  });

  it('accepts the limits (duration 1 and 480, buffers 0 and 240, name of 100 characters)', () => {
    expect(
      createType.safeParse({
        name: 'x'.repeat(100),
        durationMin: 480,
        bufferBeforeMin: 240,
        bufferAfterMin: 0,
      }).success,
    ).toBe(true);
    expect(createType.safeParse({ name: 'a', durationMin: 1 }).success).toBe(true);
  });

  it.each([
    ['blank name', { name: '   ', durationMin: 60 }, 'name'],
    ['name of 101 characters', { name: 'x'.repeat(101), durationMin: 60 }, 'name'],
    ['missing name', { durationMin: 60 }, 'name'],
    ['duration 0', { name: 'a', durationMin: 0 }, 'durationMin'],
    ['duration 481', { name: 'a', durationMin: 481 }, 'durationMin'],
    ['fractional duration', { name: 'a', durationMin: 30.5 }, 'durationMin'],
    ['string duration', { name: 'a', durationMin: '60' }, 'durationMin'],
    ['missing duration', { name: 'a' }, 'durationMin'],
    ['negative buffer', { name: 'a', durationMin: 5, bufferBeforeMin: -1 }, 'bufferBeforeMin'],
    ['buffer 241', { name: 'a', durationMin: 5, bufferAfterMin: 241 }, 'bufferAfterMin'],
    ['non-boolean isActive', { name: 'a', durationMin: 5, isActive: 'yes' }, 'isActive'],
  ])('rejects %s', (_label, body, field) => {
    const result = createType.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it('rejects an unknown field', () => {
    const result = createType.safeParse({ name: 'a', durationMin: 5, color: 'red' });
    expect(issues(result)).toContainEqual(['', Messages.ORDER_BODY_UNKNOWN_FIELD]);
  });
});

describe('update appointment type body', () => {
  it('keeps only the fields that were sent', () => {
    expect(updateType.safeParse({ isActive: false }).data).toEqual({ isActive: false });
    expect(updateType.safeParse({ name: ' New ', bufferAfterMin: 0 }).data).toEqual({
      name: 'New',
      bufferAfterMin: 0,
    });
  });

  it('rejects an empty body', () => {
    expect(issues(updateType.safeParse({}))).toEqual([
      ['', Messages.APPOINTMENT_TYPE_UPDATE_EMPTY],
    ]);
  });

  it('rejects out of range values and unknown fields', () => {
    expect(updateType.safeParse({ durationMin: 0 }).success).toBe(false);
    expect(updateType.safeParse({ name: '' }).success).toBe(false);
    expect(updateType.safeParse({ name: 'a', extra: 1 }).success).toBe(false);
  });
});

describe('list appointment types query', () => {
  it('parses isActive and the paging defaults', () => {
    expect(listTypes.safeParse({}).data).toEqual({ page: 1, limit: 20 });
    expect(listTypes.safeParse({ isActive: 'false' }).data.isActive).toBe(false);
    expect(listTypes.safeParse({ isActive: 'true' }).data.isActive).toBe(true);
  });

  it('rejects other isActive values and unknown parameters', () => {
    expect(listTypes.safeParse({ isActive: 'TRUE' }).success).toBe(false);
    expect(issues(listTypes.safeParse({ nope: '1' }))).toContainEqual([
      '',
      Messages.ORDER_QUERY_UNKNOWN_FIELD,
    ]);
  });
});

describe('create appointment body', () => {
  const valid = {
    coachId: ID,
    memberId: ID,
    appointmentTypeId: ID,
    startAt: '2026-12-01T10:00:00Z',
  };

  it('turns startAt into a Date (Z and offset forms)', () => {
    expect(createAppointment.safeParse(valid).data.startAt).toEqual(
      new Date('2026-12-01T10:00:00.000Z'),
    );
    expect(
      createAppointment.safeParse({ ...valid, startAt: '2026-12-01T14:00:00+04:00' }).data.startAt,
    ).toEqual(new Date('2026-12-01T10:00:00.000Z'));
  });

  it('reports every missing field together', () => {
    expect(issues(createAppointment.safeParse({}))).toEqual([
      ['coachId', Messages.APPOINTMENT_COACH_ID_REQUIRED],
      ['memberId', Messages.APPOINTMENT_MEMBER_ID_REQUIRED],
      ['appointmentTypeId', Messages.APPOINTMENT_TYPE_ID_REQUIRED],
      ['startAt', Messages.APPOINTMENT_START_REQUIRED],
    ]);
  });

  it.each([
    ['no offset', '2026-12-01T10:00:00'],
    ['date only', '2026-12-01'],
    ['not a date', 'tomorrow'],
    ['impossible date', '2026-13-45T10:00:00Z'],
  ])('rejects startAt with %s', (_label, startAt) => {
    const result = createAppointment.safeParse({ ...valid, startAt });
    expect(issues(result)).toEqual([['startAt', Messages.APPOINTMENT_START_INVALID]]);
  });

  it('rejects bad ids and unknown fields', () => {
    expect(createAppointment.safeParse({ ...valid, coachId: 'x' }).success).toBe(false);
    expect(createAppointment.safeParse({ ...valid, memberId: 'x' }).success).toBe(false);
    expect(createAppointment.safeParse({ ...valid, endAt: valid.startAt }).success).toBe(false);
  });
});

describe('list appointments query', () => {
  it('parses filters, dates and paging', () => {
    const data = listAppointments.safeParse({
      coachId: ID,
      memberId: ID,
      state: 'BOOKED',
      from: '2026-12-01T00:00:00Z',
      to: '2026-12-02T00:00:00Z',
      page: '2',
      limit: '5',
    }).data;
    expect(data).toMatchObject({ coachId: ID, memberId: ID, state: 'BOOKED', page: 2, limit: 5 });
    expect(data.from).toBeInstanceOf(Date);
    expect(data.to).toBeInstanceOf(Date);
  });

  it('rejects lowercase state, bad dates, from >= to and unknown parameters', () => {
    expect(listAppointments.safeParse({ state: 'booked' }).success).toBe(false);
    expect(listAppointments.safeParse({ from: '2026-12-01' }).success).toBe(false);
    expect(
      issues(
        listAppointments.safeParse({ from: '2026-12-02T00:00:00Z', to: '2026-12-01T00:00:00Z' }),
      ),
    ).toEqual([['from', Messages.APPOINTMENT_RANGE_INVALID]]);
    expect(listAppointments.safeParse({ sort: 'x' }).success).toBe(false);
    expect(listAppointments.safeParse({ coachId: 'x' }).success).toBe(false);
  });
});

describe('path params', () => {
  it('require UUIDs', () => {
    expect(typeParams.safeParse({ typeId: ID }).success).toBe(true);
    expect(typeParams.safeParse({ typeId: '1' }).success).toBe(false);
    expect(appointmentParams.safeParse({ appointmentId: ID }).success).toBe(true);
    expect(appointmentParams.safeParse({ appointmentId: 'x' }).success).toBe(false);
  });
});
