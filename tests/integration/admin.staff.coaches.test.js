// The trusted-image-URL check derives the allowed host from this token.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');

// No real emails: every SMTP send goes to this mock.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { CoachType, CoachStatus } = require('../../src/constants/coach');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB plus bcrypt: each request takes seconds, jest's 5s default is too short.
jest.setTimeout(30000);

const COACHES_URL = '/api/v1/admin/staff/coaches';
const USER_AGENT = 'jest-admin-staff-coaches-test/1.0';
const IMAGE_URL = 'https://teststore.public.blob.vercel-storage.com/profile-images/coach.jpg';

describe('POST /api/v1/admin/staff/coaches', () => {
  const testData = createTestData('admin_staff_coaches');
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    mockSendMail.mockResolvedValue({});
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const newPhone = () => `+1202555${Math.floor(1000 + Math.random() * 9000)}`;

  const validBody = (overrides = {}) => ({
    fullName: 'Casey Coach',
    email: testData.newEmail(),
    phone: newPhone(),
    coachType: CoachType.SALARIED,
    ...overrides,
  });

  const createCaller = (role, overrides = {}) => testData.createUser({ role, ...overrides });

  const post = (authorization, body) => {
    const req = request(app).post(COACHES_URL).set('User-Agent', USER_AGENT);
    return (authorization ? req.set('Authorization', authorization) : req).send(body);
  };

  const postAs = (caller, body) => post(bearerFor(caller), body);

  const findUser = (email) => prisma.user.findUnique({ where: { email } });

  const findCoachOf = (email) => prisma.coach.findFirst({ where: { user: { email } } });

  const expectNothingCreated = async (email) => {
    expect(await findUser(email)).toBeNull();
    expect(mockSendMail).not.toHaveBeenCalled();
  };

  describe('success', () => {
    it.each([Role.ADMIN, Role.OWNER])('lets an %s create a coach (201)', async (role) => {
      const caller = await createCaller(role);
      const body = validBody();

      const res = await postAs(caller, body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true, message: Messages.COACH_CREATED_SUCCESS });
      expect(res.body.data).toMatchObject({
        userId: expect.any(String),
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        coachType: CoachType.SALARIED,
        status: CoachStatus.ACTIVE,
        bio: null,
        profileImageUrl: null,
        emailSent: true,
      });
    });

    it('stores a COACH user and a linked ACTIVE coach profile with the optional fields', async () => {
      const owner = await createCaller(Role.OWNER);
      const body = validBody({
        fullName: '  Frankie Freelance  ',
        coachType: CoachType.FREELANCE,
        bio: '  Ten years of coaching  ',
        profileImageUrl: IMAGE_URL,
      });

      const res = await postAs(owner, body);

      const user = await findUser(body.email);
      const coach = await findCoachOf(body.email);
      expect(user).toMatchObject({
        id: res.body.data.userId,
        fullName: 'Frankie Freelance',
        phone: body.phone,
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
        profileImageUrl: IMAGE_URL,
      });
      expect(coach).toMatchObject({
        id: res.body.data.id,
        userId: user.id,
        coachType: CoachType.FREELANCE,
        bio: 'Ten years of coaching',
        status: CoachStatus.ACTIVE,
      });
      expect(res.body.data.profileImageUrl).toBe(IMAGE_URL);
    });

    it('creates an INACTIVE coach with a DISABLED user and still emails the invitation', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ status: CoachStatus.INACTIVE });

      const res = await postAs(admin, body);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(CoachStatus.INACTIVE);
      expect((await findUser(body.email)).status).toBe(AccountStatus.DISABLED);
      expect((await findCoachOf(body.email)).status).toBe(CoachStatus.INACTIVE);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail.mock.calls[0][0].to).toBe(body.email);
    });

    it('never returns secrets and exposes only the full coach view plus emailSent', async () => {
      const admin = await createCaller(Role.ADMIN);

      const res = await postAs(admin, validBody());

      expect(Object.keys(res.body.data).sort()).toEqual(
        [
          'id',
          'userId',
          'fullName',
          'email',
          'phone',
          'profileImageUrl',
          'bio',
          'coachType',
          'status',
          'createdAt',
          'updatedAt',
          'emailSent',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/password|passwordHash|tempPassword|role/i);
    });

    it('writes a STAFF_CREATED audit row for the new user with actor and request meta', async () => {
      const owner = await createCaller(Role.OWNER);
      const body = validBody();

      const res = await postAs(owner, body);

      const log = await prisma.auditLog.findFirst({
        where: { userId: res.body.data.userId, action: AuditAction.STAFF_CREATED },
      });
      expect(log).toMatchObject({
        email: body.email,
        actorId: owner.id,
        actorRole: Role.OWNER,
        userAgent: USER_AGENT,
      });
    });

    it('emails the temporary password invitation with the COACH role, and the coach can log in', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody();

      await postAs(admin, body);

      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.text).toContain(`role of ${Role.COACH}`);
      const tempPassword = /Temporary Password: (.+)/.exec(mail.text)[1];
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: body.email, password: tempPassword });
      expect(login.status).toBe(200);
    });

    it('still returns 201 with emailSent=false and keeps the coach when sending fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('smtp down'));
      const admin = await createCaller(Role.ADMIN);
      const body = validBody();

      const res = await postAs(admin, body);

      expect(res.status).toBe(201);
      expect(res.body.data.emailSent).toBe(false);
      expect(await findCoachOf(body.email)).not.toBeNull();
    });
  });

  describe('authentication and authorization', () => {
    it('returns 401 when no token is sent', async () => {
      const res = await post(undefined, validBody());

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(AppErrors.UNAUTHORIZED.code);
    });

    it('returns 401 INVALID_TOKEN for an invalid token', async () => {
      const res = await post('Bearer not-a-jwt', validBody());

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(AppErrors.INVALID_TOKEN.code);
    });

    it.each([Role.COACH, Role.MEMBER])(
      'returns 403 FORBIDDEN for a %s caller and creates nothing',
      async (role) => {
        const caller = await createCaller(role);
        const body = validBody();

        const res = await postAs(caller, body);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          success: false,
          message: Messages.FORBIDDEN,
          code: AppErrors.FORBIDDEN.code,
        });
        await expectNothingCreated(body.email);
      },
    );

    it('uses the DB role, not the token role: a demoted ADMIN is rejected', async () => {
      const admin = await createCaller(Role.ADMIN);
      const authorization = bearerFor(admin);
      await prisma.user.update({ where: { id: admin.id }, data: { role: Role.MEMBER } });
      const body = validBody();

      const res = await post(authorization, body);

      expect(res.status).toBe(403);
      await expectNothingCreated(body.email);
    });

    it.each([
      [AccountStatus.DISABLED, AppErrors.ACCOUNT_DISABLED],
      [AccountStatus.PENDING, AppErrors.REGISTRATION_INCOMPLETE],
    ])('rejects a %s admin (403)', async (status, appError) => {
      const admin = await createCaller(Role.ADMIN, { status });
      const body = validBody();

      const res = await postAs(admin, body);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(appError.code);
      await expectNothingCreated(body.email);
    });
  });

  describe('validation', () => {
    it.each([
      ['fullName missing', 'fullName', (b) => ({ ...b, fullName: undefined })],
      ['email missing', 'email', (b) => ({ ...b, email: undefined })],
      ['email invalid', 'email', (b) => ({ ...b, email: 'not-an-email' })],
      ['phone missing', 'phone', (b) => ({ ...b, phone: undefined })],
      ['phone invalid', 'phone', (b) => ({ ...b, phone: '12ab' })],
      ['coachType missing', 'coachType', (b) => ({ ...b, coachType: undefined })],
      ['coachType invalid', 'coachType', (b) => ({ ...b, coachType: 'CONTRACTOR' })],
      ['status invalid', 'status', (b) => ({ ...b, status: 'DISABLED' })],
      ['bio too long', 'bio', (b) => ({ ...b, bio: 'a'.repeat(1001) })],
      [
        'image url untrusted',
        'profileImageUrl',
        (b) => ({ ...b, profileImageUrl: 'https://evil.test/a.jpg' }),
      ],
    ])('returns 400 VALIDATION_ERROR for %s and creates nothing', async (_label, field, mutate) => {
      const admin = await createCaller(Role.ADMIN);
      const body = mutate(validBody());

      const res = await postAs(admin, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        message: Messages.VALIDATION_FAILED,
        code: AppErrors.VALIDATION_ERROR.code,
      });
      expect(res.body.errors.map((e) => e.field)).toContain(field);
      await expectNothingCreated(body.email ?? 'none@test.invalid');
    });

    it.each([
      ['role', Role.OWNER],
      ['firstName', 'Sam'],
      ['password', 'Password123'],
      ['userId', 'abc'],
      ['salary', 1000],
    ])('returns 400 for the unknown field %s and creates nothing', async (field, value) => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody({ [field]: value });

      const res = await postAs(admin, body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(AppErrors.VALIDATION_ERROR.code);
      await expectNothingCreated(body.email);
    });
  });

  describe('uniqueness', () => {
    it.each([Role.MEMBER, Role.COACH, Role.ADMIN])(
      'returns 409 COACH_EMAIL_ALREADY_EXISTS when a %s already uses the email',
      async (role) => {
        const admin = await createCaller(Role.ADMIN);
        const existing = await createCaller(role);

        const res = await postAs(admin, validBody({ email: existing.email }));

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          success: false,
          message: Messages.COACH_EMAIL_ALREADY_EXISTS,
          code: AppErrors.COACH_EMAIL_ALREADY_EXISTS.code,
        });
        expect(mockSendMail).not.toHaveBeenCalled();
      },
    );

    it('treats the email case-insensitively', async () => {
      const admin = await createCaller(Role.ADMIN);
      const existing = await createCaller(Role.MEMBER);

      const res = await postAs(admin, validBody({ email: existing.email.toUpperCase() }));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(AppErrors.COACH_EMAIL_ALREADY_EXISTS.code);
    });

    it('allows a phone number that already belongs to another user', async () => {
      const admin = await createCaller(Role.ADMIN);
      const sharedPhone = newPhone();
      await createCaller(Role.MEMBER, { phone: sharedPhone });

      const res = await postAs(admin, validBody({ phone: sharedPhone }));

      expect(res.status).toBe(201);
    });

    it('lets exactly one of two parallel requests with the same email win', async () => {
      const admin = await createCaller(Role.ADMIN);
      const body = validBody();

      const [first, second] = await Promise.all([postAs(admin, body), postAs(admin, body)]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await prisma.coach.count({ where: { user: { email: body.email } } })).toBe(1);
    });
  });
});
