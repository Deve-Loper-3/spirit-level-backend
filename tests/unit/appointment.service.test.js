jest.mock('../../src/config/prisma', () => ({ $transaction: jest.fn() }));
jest.mock('../../src/repositories/appointment.repository', () => ({
  findAppointmentById: jest.fn(),
  listAppointments: jest.fn(),
  createAppointment: jest.fn(),
  markAppointmentCancelled: jest.fn(),
  findUserForBooking: jest.fn(),
}));
jest.mock('../../src/repositories/appointmentType.repository', () => ({
  findAppointmentTypeById: jest.fn(),
}));
jest.mock('../../src/repositories/coachSchedule.repository', () => ({
  lockCoachSchedule: jest.fn(),
}));
jest.mock('../../src/repositories/coach.repository', () => ({
  findCoachById: jest.fn(),
  findCoachByUserId: jest.fn(),
}));
jest.mock('../../src/repositories/audit-log.repository', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/services/coachSchedule.service', () => ({
  assertIntervalAssignable: jest.fn(),
}));

const prisma = require('../../src/config/prisma');
const repo = require('../../src/repositories/appointment.repository');
const typeRepo = require('../../src/repositories/appointmentType.repository');
const { lockCoachSchedule } = require('../../src/repositories/coachSchedule.repository');
const { findCoachById, findCoachByUserId } = require('../../src/repositories/coach.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const { assertIntervalAssignable } = require('../../src/services/coachSchedule.service');
const service = require('../../src/services/appointment.service');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

const NOW = new Date('2026-11-11T08:00:00.000Z');
const START = new Date('2026-12-01T06:00:00.000Z');

const COACH_ID = 'coach-1';
const MEMBER_ID = 'member-1';
const TYPE_ID = 'type-1';
const APPT_ID = 'appt-1';

const admin = { id: 'admin-id', role: Role.ADMIN };
const coachCaller = { id: 'coach-user', role: Role.COACH };
const memberCaller = { id: MEMBER_ID, role: Role.MEMBER };
const tx = { tx: true };

const coachRow = (overrides = {}) => ({ id: COACH_ID, status: 'ACTIVE', ...overrides });
const memberRow = (overrides = {}) => ({
  id: MEMBER_ID,
  role: Role.MEMBER,
  status: 'ACTIVE',
  email: 'm@test.invalid',
  ...overrides,
});
const typeRow = (overrides = {}) => ({
  id: TYPE_ID,
  durationMin: 60,
  bufferBeforeMin: 5,
  bufferAfterMin: 10,
  isActive: true,
  ...overrides,
});
const apptRow = (overrides = {}) => ({
  id: APPT_ID,
  coachId: COACH_ID,
  memberId: MEMBER_ID,
  appointmentTypeId: TYPE_ID,
  startAt: START,
  endAt: new Date('2026-12-01T07:00:00.000Z'),
  bufferBeforeMin: 5,
  bufferAfterMin: 10,
  state: 'BOOKED',
  cancelledAt: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const input = {
  coachId: COACH_ID,
  memberId: MEMBER_ID,
  appointmentTypeId: TYPE_ID,
  startAt: START,
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((work) => work(tx));
  findCoachById.mockResolvedValue(coachRow());
  repo.findUserForBooking.mockResolvedValue(memberRow());
  typeRepo.findAppointmentTypeById.mockResolvedValue(typeRow());
  repo.createAppointment.mockImplementation(async (data) => apptRow(data));
});

describe('buildBookingTimes / assertStartInFuture', () => {
  it('endAt is startAt plus the duration and the buffers are copied from the type', () => {
    expect(service.buildBookingTimes(typeRow({ durationMin: 45 }), START)).toEqual({
      startAt: START,
      endAt: new Date('2026-12-01T06:45:00.000Z'),
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
    });
  });

  it('rejects a start in the past or exactly now (400 on startAt) and accepts the future', () => {
    expect(() => service.assertStartInFuture(new Date(NOW.getTime() - 1), NOW)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }),
    );
    expect(() => service.assertStartInFuture(NOW, NOW)).toThrow(
      expect.objectContaining({ details: [expect.objectContaining({ field: 'startAt' })] }),
    );
    expect(() => service.assertStartInFuture(new Date(NOW.getTime() + 1), NOW)).not.toThrow();
  });
});

describe('createAppointment', () => {
  it('403 for a non-manager', async () => {
    await expect(
      service.createAppointment({ actor: coachCaller, input, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('400 for a start in the past, before any lookup', async () => {
    await expect(
      service.createAppointment({
        actor: admin,
        input: { ...input, startAt: new Date('2026-11-10T08:00:00Z') },
        meta: {},
        now: NOW,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(findCoachById).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown coach', () => findCoachById.mockResolvedValue(null), 404, 'COACH_NOT_FOUND'],
    [
      'unknown member',
      () => repo.findUserForBooking.mockResolvedValue(null),
      404,
      'MEMBER_NOT_FOUND',
    ],
    [
      'a user that is not a MEMBER',
      () => repo.findUserForBooking.mockResolvedValue(memberRow({ role: Role.COACH })),
      404,
      'MEMBER_NOT_FOUND',
    ],
    [
      'unknown type',
      () => typeRepo.findAppointmentTypeById.mockResolvedValue(null),
      404,
      'APPOINTMENT_TYPE_NOT_FOUND',
    ],
    [
      'inactive coach',
      () => findCoachById.mockResolvedValue(coachRow({ status: 'INACTIVE' })),
      409,
      'COACH_INACTIVE',
    ],
    [
      'member that is not active',
      () => repo.findUserForBooking.mockResolvedValue(memberRow({ status: 'DISABLED' })),
      409,
      'MEMBER_NOT_ACTIVE',
    ],
    [
      'inactive type',
      () => typeRepo.findAppointmentTypeById.mockResolvedValue(typeRow({ isActive: false })),
      409,
      'APPOINTMENT_TYPE_INACTIVE',
    ],
  ])('%s -> %i %s and nothing is written', async (_label, arrange, status, code) => {
    arrange();
    await expect(
      service.createAppointment({ actor: admin, input, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ statusCode: status, code });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repo.createAppointment).not.toHaveBeenCalled();
  });

  it('a missing reference is a 404 even when another party is also inactive', async () => {
    findCoachById.mockResolvedValue(coachRow({ status: 'INACTIVE' }));
    repo.findUserForBooking.mockResolvedValue(null);
    await expect(
      service.createAppointment({ actor: admin, input, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'MEMBER_NOT_FOUND' });
  });

  it('books with endAt and buffer snapshots, state BOOKED, and audits in the transaction', async () => {
    const out = await service.createAppointment({
      actor: admin,
      input,
      meta: { ipAddress: 'ip' },
      now: NOW,
    });
    expect(repo.createAppointment).toHaveBeenCalledWith(
      {
        coachId: COACH_ID,
        memberId: MEMBER_ID,
        appointmentTypeId: TYPE_ID,
        startAt: START,
        endAt: new Date('2026-12-01T07:00:00.000Z'),
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      },
      tx,
    );
    expect(out).toMatchObject({
      startAt: '2026-12-01T06:00:00.000Z',
      endAt: '2026-12-01T07:00:00.000Z',
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      state: 'BOOKED',
      version: 1,
      cancelledAt: null,
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: MEMBER_ID,
        action: AuditAction.APPOINTMENT_CREATED,
        actorId: 'admin-id',
        details: {
          appointmentId: APPT_ID,
          coachId: COACH_ID,
          memberId: MEMBER_ID,
          appointmentTypeId: TYPE_ID,
          startAt: '2026-12-01T06:00:00.000Z',
          endAt: '2026-12-01T07:00:00.000Z',
        },
      }),
    );
  });

  it('calls the conflict seam INSIDE the transaction, after the coach lock and before the insert', async () => {
    await service.createAppointment({ actor: admin, input, meta: {}, now: NOW });
    expect(lockCoachSchedule).toHaveBeenCalledWith(COACH_ID, tx);
    expect(assertIntervalAssignable).toHaveBeenCalledWith(
      {
        coachId: COACH_ID,
        startAt: START,
        endAt: new Date('2026-12-01T07:00:00.000Z'),
        bufferBeforeMin: 5,
        bufferAfterMin: 10,
      },
      tx,
    );
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(lockCoachSchedule)).toBeLessThan(order(assertIntervalAssignable));
    expect(order(assertIntervalAssignable)).toBeLessThan(order(repo.createAppointment));
    expect(order(repo.createAppointment)).toBeLessThan(order(createAuditLog));
  });

  it('writes nothing when the seam rejects (the 409 COACH_CONFLICT of a later release)', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      statusCode: 409,
      code: 'COACH_CONFLICT',
    });
    assertIntervalAssignable.mockRejectedValue(conflict);
    await expect(
      service.createAppointment({ actor: admin, input, meta: {}, now: NOW }),
    ).rejects.toBe(conflict);
    expect(repo.createAppointment).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('cancel rules', () => {
  it('a future BOOKED appointment can be cancelled', () => {
    expect(() => service.assertCancellable(apptRow(), NOW)).not.toThrow();
  });
  it('already cancelled -> 409 APPOINTMENT_ALREADY_CANCELLED (also when it is in the past)', () => {
    const past = apptRow({ state: 'CANCELLED', startAt: new Date('2026-01-01T00:00:00Z') });
    expect(() => service.assertCancellable(past, NOW)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'APPOINTMENT_ALREADY_CANCELLED' }),
    );
  });
  it('started or over (startAt <= now) -> 409 APPOINTMENT_PAST_IMMUTABLE', () => {
    expect(() => service.assertCancellable(apptRow({ startAt: NOW }), NOW)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'APPOINTMENT_PAST_IMMUTABLE' }),
    );
  });
});

describe('cancelAppointment', () => {
  it('403 for a non-manager', async () => {
    await expect(
      service.cancelAppointment({
        actor: memberCaller,
        appointmentId: APPT_ID,
        meta: {},
        now: NOW,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('404 for an unknown appointment', async () => {
    repo.findAppointmentById.mockResolvedValue(null);
    await expect(
      service.cancelAppointment({ actor: admin, appointmentId: APPT_ID, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  it('locks the coach, cancels with cancelledAt = now and audits in one transaction', async () => {
    repo.findAppointmentById.mockResolvedValue(apptRow());
    repo.markAppointmentCancelled.mockResolvedValue(
      apptRow({ state: 'CANCELLED', cancelledAt: NOW, version: 2 }),
    );
    const out = await service.cancelAppointment({
      actor: admin,
      appointmentId: APPT_ID,
      meta: {},
      now: NOW,
    });
    expect(lockCoachSchedule).toHaveBeenCalledWith(COACH_ID, tx);
    expect(repo.findAppointmentById).toHaveBeenLastCalledWith(APPT_ID, tx);
    expect(repo.markAppointmentCancelled).toHaveBeenCalledWith(APPT_ID, NOW, tx);
    expect(out).toMatchObject({
      state: 'CANCELLED',
      cancelledAt: '2026-11-11T08:00:00.000Z',
      version: 2,
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: MEMBER_ID,
        action: AuditAction.APPOINTMENT_CANCELLED,
        details: expect.objectContaining({ appointmentId: APPT_ID, coachId: COACH_ID }),
      }),
    );
  });

  it('a second cancel is 409 and writes nothing', async () => {
    repo.findAppointmentById.mockResolvedValue(apptRow({ state: 'CANCELLED', cancelledAt: NOW }));
    await expect(
      service.cancelAppointment({ actor: admin, appointmentId: APPT_ID, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_ALREADY_CANCELLED' });
    expect(repo.markAppointmentCancelled).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('an appointment that already started is 409', async () => {
    repo.findAppointmentById.mockResolvedValue(
      apptRow({ startAt: new Date('2026-11-11T07:00:00Z') }),
    );
    await expect(
      service.cancelAppointment({ actor: admin, appointmentId: APPT_ID, meta: {}, now: NOW }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_PAST_IMMUTABLE' });
  });
});

describe('read scope', () => {
  const query = { page: 1, limit: 20 };
  beforeEach(() => repo.listAppointments.mockResolvedValue({ rows: [apptRow()], total: 1 }));

  it('a manager passes the filters through', async () => {
    await service.listAppointments({
      caller: admin,
      query: { ...query, coachId: 'c', memberId: 'm', state: 'BOOKED' },
    });
    expect(repo.listAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ coachId: 'c', memberId: 'm', state: 'BOOKED' }),
    );
  });

  it('a coach is scoped to their own coach id, and another coach id is 403', async () => {
    findCoachByUserId.mockResolvedValue({ id: COACH_ID });
    await service.listAppointments({ caller: coachCaller, query });
    expect(repo.listAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ coachId: COACH_ID }),
    );
    await expect(
      service.listAppointments({ caller: coachCaller, query: { ...query, coachId: 'other' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.listAppointments({ caller: coachCaller, query: { ...query, coachId: COACH_ID } }),
    ).resolves.toBeDefined();
  });

  it('a coach without a coach profile is 403', async () => {
    findCoachByUserId.mockResolvedValue(null);
    await expect(service.listAppointments({ caller: coachCaller, query })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('a member is scoped to themselves, and another member id is 403', async () => {
    await service.listAppointments({ caller: memberCaller, query });
    expect(repo.listAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: MEMBER_ID }),
    );
    await expect(
      service.listAppointments({ caller: memberCaller, query: { ...query, memberId: 'other' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a member may filter by coach inside their own appointments', async () => {
    await service.listAppointments({ caller: memberCaller, query: { ...query, coachId: 'c' } });
    expect(repo.listAppointments).toHaveBeenCalledWith(
      expect.objectContaining({ coachId: 'c', memberId: MEMBER_ID }),
    );
  });

  it("getAppointment: 404 unknown, 403 for someone else's, ok for own and for a manager", async () => {
    repo.findAppointmentById.mockResolvedValue(null);
    await expect(
      service.getAppointment({ caller: admin, appointmentId: APPT_ID }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });

    repo.findAppointmentById.mockResolvedValue(apptRow());
    await expect(
      service.getAppointment({ caller: { id: 'x', role: Role.MEMBER }, appointmentId: APPT_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.getAppointment({ caller: memberCaller, appointmentId: APPT_ID }),
    ).resolves.toMatchObject({ id: APPT_ID });
    await expect(
      service.getAppointment({ caller: admin, appointmentId: APPT_ID }),
    ).resolves.toMatchObject({ id: APPT_ID });

    findCoachByUserId.mockResolvedValue({ id: 'another-coach' });
    await expect(
      service.getAppointment({ caller: coachCaller, appointmentId: APPT_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
    findCoachByUserId.mockResolvedValue({ id: COACH_ID });
    await expect(
      service.getAppointment({ caller: coachCaller, appointmentId: APPT_ID }),
    ).resolves.toMatchObject({ id: APPT_ID });
  });
});
