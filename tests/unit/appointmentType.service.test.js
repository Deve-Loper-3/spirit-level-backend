jest.mock('../../src/config/prisma', () => ({ $transaction: jest.fn() }));
jest.mock('../../src/repositories/appointmentType.repository', () => ({
  findAppointmentTypeById: jest.fn(),
  listAppointmentTypes: jest.fn(),
  findActiveTypeByName: jest.fn(),
  createAppointmentType: jest.fn(),
  updateAppointmentType: jest.fn(),
}));
jest.mock('../../src/repositories/audit-log.repository', () => ({ createAuditLog: jest.fn() }));

const prisma = require('../../src/config/prisma');
const repo = require('../../src/repositories/appointmentType.repository');
const { createAuditLog } = require('../../src/repositories/audit-log.repository');
const service = require('../../src/services/appointmentType.service');
const { AuditAction } = require('../../src/constants/audit');
const { Role } = require('../../src/constants/roles');

const TYPE_ID = '7e7e7e7e-0000-4000-8000-000000000009';
const admin = { id: 'admin-id', role: Role.ADMIN };
const coach = { id: 'coach-user', role: Role.COACH };
const member = { id: 'member-id', role: Role.MEMBER };
const tx = { tx: true };

const typeRow = (overrides = {}) => ({
  id: TYPE_ID,
  name: 'PT 60',
  durationMin: 60,
  bufferBeforeMin: 5,
  bufferAfterMin: 10,
  isActive: true,
  createdAt: new Date('2026-11-01T08:00:00Z'),
  updatedAt: new Date('2026-11-01T08:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((work) => work(tx));
});

describe('listAppointmentTypes', () => {
  beforeEach(() => repo.listAppointmentTypes.mockResolvedValue({ rows: [typeRow()], total: 1 }));

  it('lets a manager filter by isActive', async () => {
    const out = await service.listAppointmentTypes({
      caller: admin,
      query: { isActive: false, page: 1, limit: 20 },
    });
    expect(repo.listAppointmentTypes).toHaveBeenCalledWith({ isActive: false, page: 1, limit: 20 });
    expect(out.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(out.data[0].createdAt).toBe('2026-11-01T08:00:00.000Z');
  });

  it('shows a manager both kinds when no filter is sent', async () => {
    await service.listAppointmentTypes({ caller: admin, query: { page: 1, limit: 20 } });
    expect(repo.listAppointmentTypes.mock.calls[0][0].isActive).toBeUndefined();
  });

  it.each([coach, member])(
    'forces active types for %o whatever the filter says',
    async (caller) => {
      await service.listAppointmentTypes({
        caller,
        query: { isActive: false, page: 1, limit: 20 },
      });
      expect(repo.listAppointmentTypes.mock.calls[0][0].isActive).toBe(true);
    },
  );
});

describe('createAppointmentType', () => {
  const input = {
    name: 'PT 60',
    durationMin: 60,
    bufferBeforeMin: 5,
    bufferAfterMin: 10,
    isActive: true,
  };

  it('refuses non-managers before touching anything', async () => {
    await expect(
      service.createAppointmentType({ actor: coach, input, meta: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findActiveTypeByName).not.toHaveBeenCalled();
  });

  it('creates the type and writes the audit row in the same transaction', async () => {
    repo.findActiveTypeByName.mockResolvedValue(null);
    repo.createAppointmentType.mockResolvedValue(typeRow());
    const out = await service.createAppointmentType({
      actor: admin,
      input,
      meta: { ipAddress: 'ip' },
    });
    expect(out.id).toBe(TYPE_ID);
    expect(repo.createAppointmentType).toHaveBeenCalledWith(input, tx);
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: AuditAction.APPOINTMENT_TYPE_CREATED,
        actorId: 'admin-id',
        details: expect.objectContaining({ appointmentTypeId: TYPE_ID, name: 'PT 60' }),
      }),
    );
  });

  it('409 when an active type has the name (case-insensitive lookup)', async () => {
    repo.findActiveTypeByName.mockResolvedValue({ id: 'other' });
    await expect(
      service.createAppointmentType({ actor: admin, input, meta: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_TYPE_NAME_TAKEN' });
    expect(repo.createAppointmentType).not.toHaveBeenCalled();
  });

  it('does not look for a clash when the new type is inactive', async () => {
    repo.createAppointmentType.mockResolvedValue(typeRow({ isActive: false }));
    await service.createAppointmentType({
      actor: admin,
      input: { ...input, isActive: false },
      meta: {},
    });
    expect(repo.findActiveTypeByName).not.toHaveBeenCalled();
  });

  it('maps the database unique violation (a race) to the same 409', async () => {
    repo.findActiveTypeByName.mockResolvedValue(null);
    repo.createAppointmentType.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    await expect(
      service.createAppointmentType({ actor: admin, input, meta: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_TYPE_NAME_TAKEN' });
  });

  it('lets other errors through unchanged', async () => {
    repo.findActiveTypeByName.mockResolvedValue(null);
    repo.createAppointmentType.mockRejectedValue(new Error('boom'));
    await expect(service.createAppointmentType({ actor: admin, input, meta: {} })).rejects.toThrow(
      'boom',
    );
  });
});

describe('updateAppointmentType', () => {
  it('404 for an unknown type', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(null);
    await expect(
      service.updateAppointmentType({
        actor: admin,
        typeId: TYPE_ID,
        patch: { name: 'x' },
        meta: {},
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_TYPE_NOT_FOUND' });
  });

  it('403 for a non-manager', async () => {
    await expect(
      service.updateAppointmentType({
        actor: member,
        typeId: TYPE_ID,
        patch: { name: 'x' },
        meta: {},
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('writes only the changed fields and audits before and after', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(typeRow());
    repo.findActiveTypeByName.mockResolvedValue(null);
    repo.updateAppointmentType.mockResolvedValue(typeRow({ name: 'PT 45', durationMin: 45 }));
    await service.updateAppointmentType({
      actor: admin,
      typeId: TYPE_ID,
      patch: { name: 'PT 45', durationMin: 45, bufferAfterMin: 10 }, // last one is unchanged
      meta: {},
    });
    expect(repo.updateAppointmentType).toHaveBeenCalledWith(
      TYPE_ID,
      { name: 'PT 45', durationMin: 45 },
      tx,
    );
    expect(repo.findActiveTypeByName).toHaveBeenCalledWith(
      { name: 'PT 45', excludeId: TYPE_ID },
      tx,
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: AuditAction.APPOINTMENT_TYPE_UPDATED,
        details: expect.objectContaining({
          changed: ['name', 'durationMin'],
          before: { name: 'PT 60', durationMin: 60 },
          after: { name: 'PT 45', durationMin: 45 },
        }),
      }),
    );
  });

  it('does nothing (no write, no audit) when nothing changes', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(typeRow());
    const out = await service.updateAppointmentType({
      actor: admin,
      typeId: TYPE_ID,
      patch: { name: 'PT 60', isActive: true },
      meta: {},
    });
    expect(out.id).toBe(TYPE_ID);
    expect(repo.updateAppointmentType).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('409 when re-activating a type whose name an active type now uses', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(typeRow({ isActive: false }));
    repo.findActiveTypeByName.mockResolvedValue({ id: 'other' });
    await expect(
      service.updateAppointmentType({
        actor: admin,
        typeId: TYPE_ID,
        patch: { isActive: true },
        meta: {},
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_TYPE_NAME_TAKEN' });
  });

  it('deactivating, or editing duration only, never looks for a name clash', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(typeRow());
    repo.updateAppointmentType.mockResolvedValue(typeRow({ isActive: false }));
    await service.updateAppointmentType({
      actor: admin,
      typeId: TYPE_ID,
      patch: { isActive: false },
      meta: {},
    });
    await service.updateAppointmentType({
      actor: admin,
      typeId: TYPE_ID,
      patch: { durationMin: 30 },
      meta: {},
    });
    expect(repo.findActiveTypeByName).not.toHaveBeenCalled();
  });

  it('maps the database unique violation to 409', async () => {
    repo.findAppointmentTypeById.mockResolvedValue(typeRow({ isActive: false }));
    repo.findActiveTypeByName.mockResolvedValue(null);
    repo.updateAppointmentType.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    await expect(
      service.updateAppointmentType({
        actor: admin,
        typeId: TYPE_ID,
        patch: { isActive: true },
        meta: {},
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_TYPE_NAME_TAKEN' });
  });
});
