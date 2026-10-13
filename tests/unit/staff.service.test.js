const { Prisma } = require('@prisma/client');
const prisma = require('../../src/config/prisma');
const userRepository = require('../../src/repositories/user.repository');
const staffRepository = require('../../src/repositories/staff.repository');
const auditLogRepository = require('../../src/repositories/audit-log.repository');
const notifyService = require('../../src/infra/mail/notify.service');
const logger = require('../../src/config/logger');
const { createStaff } = require('../../src/services/staff.service');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { AppErrors } = require('../../src/constants/errors');
const { Messages } = require('../../src/constants/messages');
const { PASSWORD_REGEX } = require('../../src/utils/password.util');

jest.mock('../../src/config/prisma', () => ({
  $transaction: jest.fn(),
}));
jest.mock('../../src/repositories/user.repository');
jest.mock('../../src/repositories/staff.repository');
jest.mock('../../src/repositories/audit-log.repository');
jest.mock('../../src/infra/mail/notify.service');
jest.mock('../../src/config/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('staff.service - createStaff', () => {
  const actorAdmin = { id: 'admin-id-1', role: Role.ADMIN };
  const actorOwner = { id: 'owner-id-1', role: Role.OWNER };
  const meta = { ipAddress: '192.168.1.1', userAgent: 'test-agent' };

  const validPayload = {
    fullName: 'Jane Staff',
    email: 'jane.staff@example.com',
    phone: '+15551234567',
    role: Role.COACH,
  };

  const mockTx = {
    user: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    userRepository.findByEmail.mockResolvedValue(null);

    prisma.$transaction.mockImplementation(async (callback) => callback(mockTx));

    staffRepository.createStaffUser.mockImplementation(async (data) => ({
      id: data.id,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      role: data.role,
      status: AccountStatus.ACTIVE,
      mustChangePassword: true,
      createdAt: new Date('2026-10-05T00:00:00.000Z'),
    }));

    auditLogRepository.createAuditLog.mockResolvedValue({ id: 'audit-log-id' });
    notifyService.sendStaffInvitation.mockResolvedValue({ messageId: 'mock-msg-123' });
  });

  describe('allowed creation matrix', () => {
    it.each([
      { actor: actorAdmin, targetRole: Role.COACH, label: 'ADMIN -> COACH' },
      { actor: actorAdmin, targetRole: Role.ADMIN, label: 'ADMIN -> ADMIN' },
      { actor: actorOwner, targetRole: Role.COACH, label: 'OWNER -> COACH' },
      { actor: actorOwner, targetRole: Role.ADMIN, label: 'OWNER -> ADMIN' },
      { actor: actorOwner, targetRole: Role.OWNER, label: 'OWNER -> OWNER' },
    ])('allows $label', async ({ actor, targetRole }) => {
      const payload = { ...validPayload, role: targetRole };

      const result = await createStaff(actor, payload, meta);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tempPassword');
      expect(result).toHaveProperty('emailSent', true);
      expect(result.user.role).toBe(targetRole);
      expect(result.user.email).toBe(payload.email);
      expect(result.user.status).toBe(AccountStatus.ACTIVE);
      expect(notifyService.sendStaffInvitation).toHaveBeenCalledWith(
        {
          email: payload.email,
          fullName: payload.fullName,
          role: targetRole,
        },
        result.tempPassword,
      );
    });
  });

  describe('denied role policy', () => {
    it('denies ADMIN -> OWNER, logs STAFF_CREATE_DENIED audit, and throws 403 STAFF_ROLE_NOT_ALLOWED', async () => {
      const payload = { ...validPayload, role: Role.OWNER };

      await expect(createStaff(actorAdmin, payload, meta)).rejects.toMatchObject({
        statusCode: AppErrors.STAFF_ROLE_NOT_ALLOWED.statusCode,
        code: AppErrors.STAFF_ROLE_NOT_ALLOWED.code,
        message: AppErrors.STAFF_ROLE_NOT_ALLOWED.message,
      });

      expect(auditLogRepository.createAuditLog).toHaveBeenCalledTimes(1);
      expect(auditLogRepository.createAuditLog).toHaveBeenCalledWith(prisma, {
        action: AuditAction.STAFF_CREATE_DENIED,
        actorId: actorAdmin.id,
        actorRole: actorAdmin.role,
        reason: 'ADMIN attempted to create OWNER',
        email: payload.email,
        meta,
      });

      expect(userRepository.findByEmail).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(staffRepository.createStaffUser).not.toHaveBeenCalled();
    });

    it('denies unauthorized caller role (MEMBER -> COACH) with audit and 403', async () => {
      const actorMember = { id: 'member-id-1', role: Role.MEMBER };

      await expect(createStaff(actorMember, validPayload, meta)).rejects.toMatchObject({
        statusCode: AppErrors.STAFF_ROLE_NOT_ALLOWED.statusCode,
        code: AppErrors.STAFF_ROLE_NOT_ALLOWED.code,
      });

      expect(auditLogRepository.createAuditLog).toHaveBeenCalledWith(prisma, {
        action: AuditAction.STAFF_CREATE_DENIED,
        actorId: actorMember.id,
        actorRole: actorMember.role,
        reason: 'MEMBER attempted to create COACH',
        email: validPayload.email,
        meta,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('duplicate email check', () => {
    it('throws 409 USER_ALREADY_EXISTS when email already exists without checking phone', async () => {
      userRepository.findByEmail.mockResolvedValue({
        id: 'existing-id',
        email: validPayload.email,
      });

      await expect(createStaff(actorAdmin, validPayload, meta)).rejects.toMatchObject({
        statusCode: AppErrors.USER_ALREADY_EXISTS.statusCode,
        code: AppErrors.USER_ALREADY_EXISTS.code,
        message: AppErrors.USER_ALREADY_EXISTS.message,
      });

      expect(userRepository.findByEmail).toHaveBeenCalledWith(validPayload.email);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(staffRepository.createStaffUser).not.toHaveBeenCalled();
    });
  });

  describe('transaction atomicity & error mapping', () => {
    it('executes user creation and STAFF_CREATED audit in ONE transaction with tx client', async () => {
      const result = await createStaff(actorAdmin, validPayload, meta);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(staffRepository.createStaffUser).toHaveBeenCalledTimes(1);
      expect(staffRepository.createStaffUser).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: validPayload.fullName,
          email: validPayload.email,
          phone: validPayload.phone,
          role: validPayload.role,
        }),
        mockTx,
      );

      expect(auditLogRepository.createAuditLog).toHaveBeenCalledTimes(1);
      expect(auditLogRepository.createAuditLog).toHaveBeenCalledWith(mockTx, {
        userId: result.user.id,
        action: AuditAction.STAFF_CREATED,
        email: result.user.email,
        actorId: actorAdmin.id,
        actorRole: actorAdmin.role,
        meta,
      });
    });

    it('maps Prisma P2002 unique constraint race error to 409 USER_ALREADY_EXISTS', async () => {
      const prismaRaceError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      prisma.$transaction.mockRejectedValue(prismaRaceError);

      await expect(createStaff(actorAdmin, validPayload, meta)).rejects.toMatchObject({
        statusCode: AppErrors.USER_ALREADY_EXISTS.statusCode,
        code: AppErrors.USER_ALREADY_EXISTS.code,
        message: AppErrors.USER_ALREADY_EXISTS.message,
      });
    });

    it('maps generic object with code P2002 to 409 USER_ALREADY_EXISTS', async () => {
      const mockP2002Error = new Error('Unique constraint failed');
      mockP2002Error.code = 'P2002';
      prisma.$transaction.mockRejectedValue(mockP2002Error);

      await expect(createStaff(actorAdmin, validPayload, meta)).rejects.toMatchObject({
        statusCode: AppErrors.USER_ALREADY_EXISTS.statusCode,
        code: AppErrors.USER_ALREADY_EXISTS.code,
      });
    });

    it('rethrows unexpected non-P2002 transaction errors unchanged', async () => {
      const unexpectedError = new Error('Database connection failed');
      prisma.$transaction.mockRejectedValue(unexpectedError);

      await expect(createStaff(actorAdmin, validPayload, meta)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('credentials, security, and response formatting', () => {
    it('generates a valid BCrypt hash that differs from tempPassword and meets length requirement', async () => {
      const result = await createStaff(actorAdmin, validPayload, meta);

      expect(typeof result.tempPassword).toBe('string');
      expect(result.tempPassword.length).toBeGreaterThanOrEqual(12);
      expect(PASSWORD_REGEX.test(result.tempPassword)).toBe(true);

      const createdUserData = staffRepository.createStaffUser.mock.calls[0][0];
      expect(createdUserData.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
      expect(createdUserData.passwordHash).not.toBe(result.tempPassword);
    });

    it('never includes password or passwordHash in audit log or user response', async () => {
      const result = await createStaff(actorAdmin, validPayload, meta);

      // Verify user response shape
      expect(result.user).toEqual({
        id: expect.any(String),
        fullName: validPayload.fullName,
        email: validPayload.email,
        phone: validPayload.phone,
        role: validPayload.role,
        status: AccountStatus.ACTIVE,
      });
      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('tempPassword');

      // Verify audit log payload
      const auditCall = auditLogRepository.createAuditLog.mock.calls[0];
      const auditPayload = auditCall[1];
      const serializedAudit = JSON.stringify(auditPayload);

      expect(serializedAudit).not.toContain(result.tempPassword);
      expect(serializedAudit).not.toContain('$2b$');
      expect(auditPayload).not.toHaveProperty('password');
      expect(auditPayload).not.toHaveProperty('passwordHash');
    });

    it('ensures denied audit call also never includes passwords', async () => {
      const payload = { ...validPayload, role: Role.OWNER };

      await expect(createStaff(actorAdmin, payload, meta)).rejects.toThrow();

      const auditPayload = auditLogRepository.createAuditLog.mock.calls[0][1];
      expect(auditPayload).not.toHaveProperty('password');
      expect(auditPayload).not.toHaveProperty('passwordHash');
      expect(auditPayload).not.toHaveProperty('tempPassword');
    });
  });

  describe('post-commit invitation email handling', () => {
    it('dispatches invitation email after transaction commit and returns emailSent=true', async () => {
      const result = await createStaff(actorAdmin, validPayload, meta);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(notifyService.sendStaffInvitation).toHaveBeenCalledTimes(1);
      expect(notifyService.sendStaffInvitation).toHaveBeenCalledWith(
        {
          email: validPayload.email,
          fullName: validPayload.fullName,
          role: validPayload.role,
        },
        result.tempPassword,
      );
      expect(result.emailSent).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not send email if database transaction fails', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('DB failure'));

      await expect(createStaff(actorAdmin, validPayload, meta)).rejects.toThrow('DB failure');

      expect(notifyService.sendStaffInvitation).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('catches email failure, logs error safely without passwords, and returns emailSent=false without failing user creation', async () => {
      const emailError = new Error('SMTP connection refused');
      emailError.code = 'ECONNREFUSED';
      notifyService.sendStaffInvitation.mockRejectedValueOnce(emailError);

      const result = await createStaff(actorAdmin, validPayload, meta);

      expect(result.emailSent).toBe(false);
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(validPayload.email);
      expect(result.user.status).toBe(AccountStatus.ACTIVE);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [loggedMeta, loggedMsg] = logger.error.mock.calls[0];

      expect(loggedMsg).toBe(Messages.STAFF_INVITATION_EMAIL_FAILED);
      expect(loggedMeta).toMatchObject({
        userId: result.user.id,
        email: validPayload.email,
        errorName: 'Error',
        errorCode: 'ECONNREFUSED',
      });

      const serializedLogs = JSON.stringify(logger.error.mock.calls);
      expect(serializedLogs).not.toContain(result.tempPassword);
      expect(serializedLogs).not.toContain('$2b$');
      expect(loggedMeta).not.toHaveProperty('password');
      expect(loggedMeta).not.toHaveProperty('tempPassword');
    });
  });
});
