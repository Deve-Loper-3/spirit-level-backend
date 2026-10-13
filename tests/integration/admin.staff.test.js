const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');

// No real emails: every SMTP send goes to this mock.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const env = require('../../src/config/env');
const { comparePassword } = require('../../src/utils/password.util');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');
const { AuditAction } = require('../../src/constants/audit');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(30000);

const STAFF_URL = '/api/v1/admin/staff';
const LOGIN_URL = '/api/v1/auth/login';
const USER_AGENT = 'jest-admin-staff-test/1.0';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;
const TEMP_PASSWORD_LINE = /Temporary Password: (.+)/;

describe('POST /api/v1/admin/staff', () => {
  const testData = createTestData('admin_staff');
  const createdEmails = [];
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    mockSendMail.mockResolvedValue({});
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  const newStaffEmail = () => {
    const email = testData.newEmail();
    createdEmails.push(email);
    return email;
  };

  const newPhone = () => `+1202555${Math.floor(1000 + Math.random() * 9000)}`;

  const validBody = (overrides = {}) => ({
    fullName: 'Staff Member',
    email: newStaffEmail(),
    phone: newPhone(),
    role: Role.COACH,
    ...overrides,
  });

  const createCaller = (role, overrides = {}) => testData.createUser({ role, ...overrides });

  const post = (authorization, body) => {
    const req = request(app).post(STAFF_URL).set('User-Agent', USER_AGENT);
    return (authorization ? req.set('Authorization', authorization) : req).send(body);
  };

  const postAs = (caller, body) => post(bearerFor(caller), body);

  const findUser = (email) => prisma.user.findUnique({ where: { email } });

  const findLog = (where) => prisma.auditLog.findFirst({ where });

  const sentTempPassword = () => TEMP_PASSWORD_LINE.exec(mockSendMail.mock.calls[0][0].text)[1];

  describe('role policy', () => {
    it.each([Role.COACH, Role.ADMIN])('lets an ADMIN create a %s (201)', async (role) => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ role });

      const res = await postAs(admin, body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true, message: Messages.STAFF_CREATED_SUCCESS });
      expect(res.body.data).toMatchObject({ email: body.email, role });
    });

    it('rejects an ADMIN creating an OWNER (403 STAFF_ROLE_NOT_ALLOWED) and creates nothing', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ role: Role.OWNER });

      const res = await postAs(admin, body);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.STAFF_ROLE_NOT_ALLOWED });
      expect(await findUser(body.email)).toBeNull();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it.each([Role.COACH, Role.ADMIN, Role.OWNER])(
      'lets an OWNER create a %s (201)',
      async (role) => {
        const owner = await createCaller(Role.OWNER);
        const body = validBody({ role });

        const res = await postAs(owner, body);

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ email: body.email, role });
      },
    );

    it.each([Role.COACH, Role.MEMBER])('rejects a %s caller (403 FORBIDDEN)', async (role) => {
      const caller = await createCaller(role);
      const body = validBody();

      const res = await postAs(caller, body);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.FORBIDDEN });
      expect(await findUser(body.email)).toBeNull();
    });
  });

  describe('authentication', () => {
    it('returns 401 when no token is sent', async () => {
      const res = await post(undefined, validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.NO_TOKEN_PROVIDED });
    });

    it('returns 401 INVALID_TOKEN for an invalid token', async () => {
      const res = await post('Bearer not-a-jwt', validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
      const admin = await createCaller(Role.ADMIN);
      const expired = jwt.sign({ role: admin.role, type: 'access' }, env.JWT_ACCESS_SECRET, {
        algorithm: 'HS256',
        subject: admin.id,
        expiresIn: -10,
      });

      const res = await post(`Bearer ${expired}`, validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.TOKEN_EXPIRED });
    });

    it('returns 401 INVALID_TOKEN when the token user no longer exists', async () => {
      const ghost = { id: crypto.randomUUID(), role: Role.OWNER };

      const res = await postAs(ghost, validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: Messages.INVALID_TOKEN });
    });

    it('uses the DB role, not the token role: demoted ADMIN is rejected', async () => {
      const admin = await createCaller(Role.ADMIN);
      const authorization = bearerFor(admin);
      await prisma.user.update({ where: { id: admin.id }, data: { role: Role.COACH } });
      const body = validBody();

      const res = await post(authorization, body);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(Messages.FORBIDDEN);
      expect(await findUser(body.email)).toBeNull();
    });

    it('uses the DB role, not the token role: promoted COACH is accepted', async () => {
      const coach = await createCaller(Role.COACH);
      const authorization = bearerFor(coach);
      await prisma.user.update({ where: { id: coach.id }, data: { role: Role.ADMIN } });

      const res = await post(authorization, validBody());

      expect(res.status).toBe(201);
    });

    it.each([
      [AccountStatus.DISABLED, Messages.ACCOUNT_DISABLED],
      [AccountStatus.PENDING, Messages.REGISTRATION_INCOMPLETE],
    ])('rejects a %s caller (403)', async (status, message) => {
      const admin = await createCaller(Role.ADMIN, { status });
      const body = validBody();

      const res = await postAs(admin, body);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message });
      expect(await findUser(body.email)).toBeNull();
    });
  });

  describe('uniqueness', () => {
    it('returns 409 USER_ALREADY_EXISTS for a duplicate email', async () => {
      const admin = await createCaller(Role.ADMIN);
      const existing = await createCaller(Role.MEMBER);

      const res = await postAs(admin, validBody({ email: existing.email }));

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ success: false, message: Messages.USER_ALREADY_EXISTS });
    });

    it('treats the email case-insensitively (different case is still a duplicate)', async () => {
      const admin = await createCaller(Role.ADMIN);
      const existing = await createCaller(Role.MEMBER);

      const res = await postAs(admin, validBody({ email: existing.email.toUpperCase() }));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(Messages.USER_ALREADY_EXISTS);
    });

    it('allows a phone number that already belongs to another user', async () => {
      const admin = await createCaller(Role.ADMIN);
      const sharedPhone = newPhone();
      const existing = await createCaller(Role.MEMBER, { phone: sharedPhone });
      const body = validBody({ phone: sharedPhone });

      const res = await postAs(admin, body);

      expect(res.status).toBe(201);
      expect((await findUser(body.email)).phone).toBe(existing.phone);
    });
  });

  describe('validation', () => {
    it.each([
      ['fullName missing', 'fullName', (b) => ({ ...b, fullName: undefined })],
      ['fullName too short', 'fullName', (b) => ({ ...b, fullName: 'A' })],
      ['fullName too long', 'fullName', (b) => ({ ...b, fullName: 'A'.repeat(101) })],
      ['email missing', 'email', (b) => ({ ...b, email: undefined })],
      ['email invalid', 'email', (b) => ({ ...b, email: 'not-an-email' })],
      ['phone missing', 'phone', (b) => ({ ...b, phone: undefined })],
      ['phone invalid', 'phone', (b) => ({ ...b, phone: '12ab' })],
      ['role missing', 'role', (b) => ({ ...b, role: undefined })],
      ['role MEMBER', 'role', (b) => ({ ...b, role: Role.MEMBER })],
      ['role unknown', 'role', (b) => ({ ...b, role: 'SUPERUSER' })],
    ])('returns 400 for %s', async (_label, field, mutate) => {
      const admin = await createCaller(Role.ADMIN);

      const res = await postAs(admin, mutate(validBody()));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors.map((e) => e.field)).toContain(field);
    });

    it.each([
      ['firstName', 'Sam'],
      ['lastName', 'Coach'],
      ['gender', Gender.MALE],
      ['status', AccountStatus.ACTIVE],
      ['password', 'Password123'],
      ['mustChangePassword', false],
    ])('returns 400 for the unknown field %s and creates nothing', async (field, value) => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ [field]: value });

      const res = await postAs(admin, body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(await findUser(body.email)).toBeNull();
    });
  });

  describe('created staff user', () => {
    it('stores an ACTIVE staff user with forced defaults and a BCrypt-hashed temp password', async () => {
      const owner = await createCaller(Role.OWNER);
      const body = validBody({ fullName: '  Alex Admin  ', role: Role.ADMIN });

      const res = await postAs(owner, body);

      const stored = await findUser(body.email);
      expect(stored).toMatchObject({
        id: res.body.data.id,
        fullName: 'Alex Admin',
        phone: body.phone,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        gender: Gender.PREFER_NOT_TO_SAY,
        mustChangePassword: true,
      });
      const tempPassword = sentTempPassword();
      expect(stored.passwordHash).toMatch(BCRYPT_HASH_PATTERN);
      expect(stored.passwordHash).not.toBe(tempPassword);
      expect(await comparePassword(tempPassword, stored.passwordHash)).toBe(true);
    });

    it('returns only the whitelisted fields plus emailSent, never secrets', async () => {
      const admin = await createCaller(Role.ADMIN);

      const res = await postAs(admin, validBody());

      expect(Object.keys(res.body.data).sort()).toEqual(
        ['id', 'fullName', 'email', 'phone', 'role', 'status', 'emailSent'].sort(),
      );
      expect(res.body.data).toMatchObject({ status: AccountStatus.ACTIVE, emailSent: true });
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain(sentTempPassword());
      expect(rawBody).not.toMatch(/tempPassword|password|passwordHash|gender|mustChangePassword/i);
    });
  });

  describe('audit log', () => {
    it('writes a STAFF_CREATED row with user, actor and request meta', async () => {
      const owner = await createCaller(Role.OWNER);
      const body = validBody();

      const res = await postAs(owner, body);

      const log = await findLog({ userId: res.body.data.id, action: AuditAction.STAFF_CREATED });
      expect(log).toMatchObject({
        email: body.email,
        actorId: owner.id,
        actorRole: Role.OWNER,
        userAgent: USER_AGENT,
      });
      expect(log.ipAddress).not.toBeNull();
    });

    it('writes a STAFF_CREATE_DENIED row when the role policy denies the request', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ role: Role.OWNER });

      await postAs(admin, body);

      const log = await findLog({ email: body.email, action: AuditAction.STAFF_CREATE_DENIED });
      expect(log).toMatchObject({
        userId: null,
        actorId: admin.id,
        actorRole: Role.ADMIN,
        reason: 'ADMIN attempted to create OWNER',
        userAgent: USER_AGENT,
      });
      expect(log.ipAddress).not.toBeNull();
    });
  });

  describe('invitation email', () => {
    it('sends exactly one email to the new staff member with their role', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ role: Role.COACH });

      await postAs(admin, body);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.to).toBe(body.email);
      expect(mail.text).toContain(`role of ${Role.COACH}`);
      expect(mail.text).toContain(body.fullName);
    });

    it('emails a temporary password that works for logging in', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody();
      const created = await postAs(admin, body);

      const res = await request(app)
        .post(LOGIN_URL)
        .send({ email: body.email, password: sentTempPassword() });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(created.body.data.id);
    });

    it('still returns 201 with emailSent=false and keeps the user when sending fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('smtp down'));
      const admin = await createCaller(Role.ADMIN);
      const body = validBody();

      const res = await postAs(admin, body);

      expect(res.status).toBe(201);
      expect(res.body.data.emailSent).toBe(false);
      expect(await findUser(body.email)).not.toBeNull();
    });
  });
});
