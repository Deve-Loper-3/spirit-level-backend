const prisma = require('../../src/config/prisma');
const coachRepository = require('../../src/repositories/coach.repository');
const userRepository = require('../../src/repositories/user.repository');
const sessionRepository = require('../../src/repositories/session.repository');
const auditLogRepository = require('../../src/repositories/audit-log.repository');
const {
  listCoaches,
  getCoach,
  getMyCoach,
  updateCoach,
  setCoachStatus,
} = require('../../src/services/coach.service');
const { AppErrors } = require('../../src/constants/errors');
const { AuditAction } = require('../../src/constants/audit');
const { AccountStatus } = require('../../src/constants/status');
const { Role } = require('../../src/constants/roles');
const {
  CoachStatus,
  ADMIN_COACH_UPDATE_FIELDS,
  COACH_SELF_UPDATE_FIELDS,
} = require('../../src/constants/coach');

jest.mock('../../src/config/prisma', () => ({ $transaction: jest.fn() }));
jest.mock('../../src/repositories/coach.repository');
jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/session.repository');
jest.mock('../../src/repositories/audit-log.repository');

const createdAt = new Date('2026-10-13T00:00:00.000Z');
const mockTx = { tx: true };
const admin = { id: 'admin-1', role: Role.ADMIN };
const owner = { id: 'owner-1', role: Role.OWNER };
const member = { id: 'member-1', role: Role.MEMBER };
const coachCaller = (n) => ({ id: `user-${n}`, role: Role.COACH });
const meta = { ipAddress: '10.0.0.1', userAgent: 'jest' };

const buildRow = (n, overrides = {}) => ({
  id: `coach-${n}`,
  coachType: 'SALARIED',
  bio: `Bio ${n}`,
  status: CoachStatus.ACTIVE,
  createdAt,
  updatedAt: createdAt,
  user: {
    id: `user-${n}`,
    fullName: `Coach ${n}`,
    email: `coach${n}@example.com`,
    phone: '+15551234567',
    profileImageUrl: null,
  },
  ...overrides,
});

const PUBLIC_KEYS = ['bio', 'fullName', 'id', 'profileImageUrl'];

const expectNotFound = (promise) =>
  expect(promise).rejects.toMatchObject({
    statusCode: 404,
    code: AppErrors.COACH_NOT_FOUND.code,
  });

describe('coach.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback) => callback(mockTx));
    auditLogRepository.createAuditLog.mockResolvedValue({});
  });

  describe('listCoaches', () => {
    const query = {
      page: 3,
      limit: 20,
      search: 'ann',
      status: 'INACTIVE',
      coachType: 'FREELANCE',
    };

    beforeEach(() => {
      coachRepository.listCoaches.mockResolvedValue({
        rows: [buildRow(1), buildRow(2)],
        total: 45,
      });
    });

    it.each([
      ['an ADMIN', admin],
      ['an OWNER', owner],
    ])('%s gets the full view, every filter and a name+email search', async (_label, caller) => {
      const result = await listCoaches({ caller, query });

      expect(coachRepository.listCoaches).toHaveBeenCalledWith({
        status: 'INACTIVE',
        coachType: 'FREELANCE',
        search: 'ann',
        searchFields: ['fullName', 'email'],
        skip: 40,
        take: 20,
      });
      expect(result.pagination).toEqual({ page: 3, limit: 20, total: 45, totalPages: 3 });
      expect(result.coaches[0]).toMatchObject({
        id: 'coach-1',
        userId: 'user-1',
        email: 'coach1@example.com',
        phone: '+15551234567',
        status: CoachStatus.ACTIVE,
      });
    });

    it.each([
      ['a COACH', coachCaller(9)],
      ['a MEMBER', member],
    ])(
      '%s gets the public view, ACTIVE only, no coachType filter and a name-only search',
      async (_label, caller) => {
        const result = await listCoaches({ caller, query });

        expect(coachRepository.listCoaches).toHaveBeenCalledWith({
          status: CoachStatus.ACTIVE,
          search: 'ann',
          searchFields: ['fullName'],
          skip: 40,
          take: 20,
        });
        expect(coachRepository.listCoaches.mock.calls[0][0]).not.toHaveProperty('coachType');
        for (const item of result.coaches) {
          expect(Object.keys(item).sort()).toEqual(PUBLIC_KEYS);
        }
        expect(JSON.stringify(result)).not.toMatch(/example\.com|\+1555/);
      },
    );

    it('shows a COACH the public view even for their own row in the list', async () => {
      const result = await listCoaches({ caller: coachCaller(1), query: { page: 1, limit: 20 } });

      expect(Object.keys(result.coaches[0]).sort()).toEqual(PUBLIC_KEYS);
    });

    it('treats an unknown role like a member (public view, ACTIVE only)', async () => {
      await listCoaches({ caller: { id: 'x', role: 'STRANGER' }, query: { page: 1, limit: 20 } });

      expect(coachRepository.listCoaches.mock.calls[0][0]).toMatchObject({
        status: CoachStatus.ACTIVE,
        searchFields: ['fullName'],
      });
    });

    it('returns an empty list with correct pagination for a page past the end', async () => {
      coachRepository.listCoaches.mockResolvedValue({ rows: [], total: 5 });

      const result = await listCoaches({ caller: admin, query: { page: 9, limit: 10 } });

      expect(result).toEqual({
        coaches: [],
        pagination: { page: 9, limit: 10, total: 5, totalPages: 1 },
      });
    });
  });

  describe('getCoach', () => {
    it.each([
      ['an ADMIN', admin],
      ['an OWNER', owner],
    ])('%s gets the full view of any coach, also an INACTIVE one', async (_label, caller) => {
      coachRepository.findCoachById.mockResolvedValue(
        buildRow(1, { status: CoachStatus.INACTIVE }),
      );

      const result = await getCoach({ caller, coachId: 'coach-1' });

      expect(result).toMatchObject({
        id: 'coach-1',
        userId: 'user-1',
        email: 'coach1@example.com',
        status: CoachStatus.INACTIVE,
      });
    });

    it('gives a COACH the full view of their own profile', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));

      const result = await getCoach({ caller: coachCaller(1), coachId: 'coach-1' });

      expect(result).toMatchObject({ userId: 'user-1', email: 'coach1@example.com' });
    });

    it('gives a COACH the public view of another ACTIVE coach', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));

      const result = await getCoach({ caller: coachCaller(2), coachId: 'coach-1' });

      expect(Object.keys(result).sort()).toEqual(PUBLIC_KEYS);
      expect(result).toEqual({
        id: 'coach-1',
        fullName: 'Coach 1',
        profileImageUrl: null,
        bio: 'Bio 1',
      });
    });

    it('gives a MEMBER the public view of an ACTIVE coach', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));

      const result = await getCoach({ caller: member, coachId: 'coach-1' });

      expect(Object.keys(result).sort()).toEqual(PUBLIC_KEYS);
    });

    it.each([
      ['a COACH', coachCaller(2)],
      ['a MEMBER', member],
    ])('answers 404 (never 403) to %s for an INACTIVE coach', async (_label, caller) => {
      coachRepository.findCoachById.mockResolvedValue(
        buildRow(1, { status: CoachStatus.INACTIVE }),
      );

      await expectNotFound(getCoach({ caller, coachId: 'coach-1' }));
    });

    it('throws 404 COACH_NOT_FOUND when the coach does not exist', async () => {
      coachRepository.findCoachById.mockResolvedValue(null);

      await expectNotFound(getCoach({ caller: admin, coachId: 'missing' }));
    });
  });

  describe('getMyCoach', () => {
    it('finds the profile by the caller user id and returns the full view', async () => {
      coachRepository.findCoachByUserId.mockResolvedValue(buildRow(1));

      const result = await getMyCoach(coachCaller(1));

      expect(coachRepository.findCoachByUserId).toHaveBeenCalledWith('user-1');
      expect(result).toMatchObject({ id: 'coach-1', email: 'coach1@example.com' });
    });

    it('throws 404 when the user has no coach profile', async () => {
      coachRepository.findCoachByUserId.mockResolvedValue(null);

      await expectNotFound(getMyCoach(coachCaller(7)));
    });
  });

  describe('updateCoach', () => {
    const update = (changes, allowedFields = ADMIN_COACH_UPDATE_FIELDS, actor = admin) =>
      updateCoach({ actor, coachId: 'coach-1', changes, allowedFields, meta });

    beforeEach(() => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));
      coachRepository.updateCoachWithUser.mockImplementation(
        async (_id, { userFields, coachFields }) => {
          const row = buildRow(1);
          return { ...row, ...coachFields, user: { ...row.user, ...userFields } };
        },
      );
      userRepository.findByEmail.mockResolvedValue(null);
    });

    it('splits the changes into user fields and coach fields and writes them in one transaction', async () => {
      const result = await update({
        fullName: 'New Name',
        email: 'new@example.com',
        phone: '+15550000000',
        profileImageUrl: null,
        bio: 'New bio',
        coachType: 'FREELANCE',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(coachRepository.updateCoachWithUser).toHaveBeenCalledWith(
        'coach-1',
        {
          userFields: {
            fullName: 'New Name',
            email: 'new@example.com',
            phone: '+15550000000',
            profileImageUrl: null,
          },
          coachFields: { bio: 'New bio', coachType: 'FREELANCE' },
        },
        mockTx,
      );
      expect(result).toMatchObject({
        fullName: 'New Name',
        email: 'new@example.com',
        bio: 'New bio',
        coachType: 'FREELANCE',
      });
    });

    it('passes an empty user group when only coach fields change', async () => {
      await update({ bio: 'Only bio' });

      expect(coachRepository.updateCoachWithUser.mock.calls[0][1]).toEqual({
        userFields: {},
        coachFields: { bio: 'Only bio' },
      });
    });

    it('ignores fields that are not in allowedFields', async () => {
      await update({ fullName: 'Self Edit', coachType: 'FREELANCE', email: 'hijack@example.com' }, [
        'fullName',
        'phone',
        'profileImageUrl',
        'bio',
      ]);

      expect(coachRepository.updateCoachWithUser.mock.calls[0][1]).toEqual({
        userFields: { fullName: 'Self Edit' },
        coachFields: {},
      });
      expect(userRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('writes a COACH_UPDATED audit row with field NAMES only, in the same transaction', async () => {
      await update({ fullName: 'Secret Name', email: 'secret@example.com', bio: 'Secret bio' });

      expect(auditLogRepository.createAuditLog).toHaveBeenCalledWith(mockTx, {
        userId: 'user-1',
        action: AuditAction.COACH_UPDATED,
        reason: 'fullName,email,bio',
        email: 'secret@example.com',
        actorId: admin.id,
        actorRole: admin.role,
        meta,
      });
      const audit = JSON.stringify(auditLogRepository.createAuditLog.mock.calls);
      expect(audit).not.toContain('Secret Name');
      expect(audit).not.toContain('Secret bio');
    });

    it('does not treat the coach own current email as a conflict', async () => {
      userRepository.findByEmail.mockResolvedValue({ id: 'user-1' });

      await expect(update({ email: 'coach1@example.com' })).resolves.toBeDefined();
    });

    it('throws 409 COACH_EMAIL_ALREADY_EXISTS when another account uses the email', async () => {
      userRepository.findByEmail.mockResolvedValue({ id: 'someone-else' });

      await expect(update({ email: 'taken@example.com' })).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_EMAIL_ALREADY_EXISTS.code,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint race inside the transaction to 409', async () => {
      const raceError = new Error('Unique constraint failed');
      raceError.code = 'P2002';
      prisma.$transaction.mockRejectedValue(raceError);

      await expect(update({ email: 'race@example.com' })).rejects.toMatchObject({
        statusCode: 409,
        code: AppErrors.COACH_EMAIL_ALREADY_EXISTS.code,
      });
    });

    it('maps a coach deleted during the update (P2025) to 404', async () => {
      const goneError = new Error('Record to update not found');
      goneError.code = 'P2025';
      prisma.$transaction.mockRejectedValue(goneError);

      await expectNotFound(update({ bio: 'x' }));
    });

    it('rethrows unexpected errors unchanged', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db down'));

      await expect(update({ bio: 'x' })).rejects.toThrow('db down');
    });

    it('throws 404 for an unknown coach and writes nothing', async () => {
      coachRepository.findCoachById.mockResolvedValue(null);

      await expectNotFound(update({ bio: 'x' }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('ownership', () => {
      it('lets a COACH edit their own profile with the self-edit fields', async () => {
        await update({ fullName: 'Me', bio: 'My bio' }, COACH_SELF_UPDATE_FIELDS, coachCaller(1));

        expect(coachRepository.updateCoachWithUser.mock.calls[0][1]).toEqual({
          userFields: { fullName: 'Me' },
          coachFields: { bio: 'My bio' },
        });
        expect(auditLogRepository.createAuditLog.mock.calls[0][1]).toMatchObject({
          actorId: 'user-1',
          actorRole: Role.COACH,
          reason: 'fullName,bio',
        });
      });

      it('caps a COACH at the self-edit fields even if the route offers more', async () => {
        await update(
          { fullName: 'Me', email: 'new@example.com', coachType: 'FREELANCE' },
          ADMIN_COACH_UPDATE_FIELDS,
          coachCaller(1),
        );

        expect(coachRepository.updateCoachWithUser.mock.calls[0][1]).toEqual({
          userFields: { fullName: 'Me' },
          coachFields: {},
        });
        expect(userRepository.findByEmail).not.toHaveBeenCalled();
      });

      it('answers 403 FORBIDDEN when a COACH edits another ACTIVE coach, and writes nothing', async () => {
        await expect(
          update({ bio: 'Hacked' }, COACH_SELF_UPDATE_FIELDS, coachCaller(2)),
        ).rejects.toMatchObject({ statusCode: 403, code: AppErrors.FORBIDDEN.code });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('answers 404 when a COACH edits another INACTIVE coach (existence stays hidden)', async () => {
        coachRepository.findCoachById.mockResolvedValue(
          buildRow(1, { status: CoachStatus.INACTIVE }),
        );

        await expectNotFound(update({ bio: 'x' }, COACH_SELF_UPDATE_FIELDS, coachCaller(2)));
      });

      it('answers 403 to a MEMBER even if the route let them through', async () => {
        await expect(update({ bio: 'x' }, COACH_SELF_UPDATE_FIELDS, member)).rejects.toMatchObject({
          statusCode: 403,
          code: AppErrors.FORBIDDEN.code,
        });
        expect(coachRepository.updateCoachWithUser).not.toHaveBeenCalled();
      });

      it('answers 403 to a role without edit fields, even on the profile with their own user id', async () => {
        const stranger = { id: 'user-1', role: 'STRANGER' };

        await expect(
          update({ bio: 'x' }, COACH_SELF_UPDATE_FIELDS, stranger),
        ).rejects.toMatchObject({
          statusCode: 403,
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  describe('setCoachStatus', () => {
    const setStatus = (status, actor = admin) =>
      setCoachStatus({ actor, coachId: 'coach-1', status, meta });

    beforeEach(() => {
      coachRepository.updateCoachStatus.mockResolvedValue(true);
      userRepository.updateStatusIfCurrent.mockResolvedValue(1);
      sessionRepository.revokeAllByUser.mockResolvedValue(2);
    });

    it('deactivating: coach INACTIVE, user ACTIVE -> DISABLED, sessions revoked, audit row, one transaction', async () => {
      coachRepository.findCoachById
        .mockResolvedValueOnce(buildRow(1))
        .mockResolvedValueOnce(buildRow(1, { status: CoachStatus.INACTIVE }));

      const result = await setStatus(CoachStatus.INACTIVE);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(coachRepository.updateCoachStatus).toHaveBeenCalledWith(
        'coach-1',
        CoachStatus.INACTIVE,
        mockTx,
      );
      expect(userRepository.updateStatusIfCurrent).toHaveBeenCalledWith(
        'user-1',
        { from: AccountStatus.ACTIVE, to: AccountStatus.DISABLED },
        mockTx,
      );
      expect(sessionRepository.revokeAllByUser).toHaveBeenCalledWith(
        'user-1',
        expect.any(Date),
        mockTx,
      );
      expect(auditLogRepository.createAuditLog).toHaveBeenCalledWith(mockTx, {
        userId: 'user-1',
        action: AuditAction.COACH_STATUS_CHANGED,
        reason: 'ACTIVE->INACTIVE',
        email: 'coach1@example.com',
        actorId: admin.id,
        actorRole: admin.role,
        meta,
      });
      expect(result.status).toBe(CoachStatus.INACTIVE);
    });

    it('activating: user DISABLED -> ACTIVE only, and no session is revoked', async () => {
      coachRepository.findCoachById
        .mockResolvedValueOnce(buildRow(1, { status: CoachStatus.INACTIVE }))
        .mockResolvedValueOnce(buildRow(1));

      const result = await setStatus(CoachStatus.ACTIVE);

      expect(userRepository.updateStatusIfCurrent).toHaveBeenCalledWith(
        'user-1',
        { from: AccountStatus.DISABLED, to: AccountStatus.ACTIVE },
        mockTx,
      );
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
      expect(auditLogRepository.createAuditLog.mock.calls[0][1].reason).toBe('INACTIVE->ACTIVE');
      expect(result.status).toBe(CoachStatus.ACTIVE);
    });

    it('is idempotent: an unchanged status writes no user change, no revoke and no audit row', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));
      coachRepository.updateCoachStatus.mockResolvedValue(false);

      const result = await setStatus(CoachStatus.ACTIVE);

      expect(userRepository.updateStatusIfCurrent).not.toHaveBeenCalled();
      expect(sessionRepository.revokeAllByUser).not.toHaveBeenCalled();
      expect(auditLogRepository.createAuditLog).not.toHaveBeenCalled();
      expect(coachRepository.findCoachById).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 'coach-1', status: CoachStatus.ACTIVE });
    });

    it('works for an OWNER too', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));

      await expect(setStatus(CoachStatus.INACTIVE, owner)).resolves.toBeDefined();
    });

    it.each([
      ['a COACH (also their own profile)', coachCaller(1)],
      ['a MEMBER', member],
    ])('answers 403 to %s and touches nothing', async (_label, actor) => {
      await expect(setStatus(CoachStatus.INACTIVE, actor)).rejects.toMatchObject({
        statusCode: 403,
        code: AppErrors.FORBIDDEN.code,
      });
      expect(coachRepository.findCoachById).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown coach and starts no transaction', async () => {
      coachRepository.findCoachById.mockResolvedValue(null);

      await expectNotFound(setStatus(CoachStatus.INACTIVE));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates a failure inside the transaction', async () => {
      coachRepository.findCoachById.mockResolvedValue(buildRow(1));
      auditLogRepository.createAuditLog.mockRejectedValue(new Error('audit unavailable'));

      await expect(setStatus(CoachStatus.INACTIVE)).rejects.toThrow('audit unavailable');
    });
  });
});
