const request = require('supertest');
const bcrypt = require('bcrypt');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');
const { Messages } = require('../../src/constants/messages');

describe('POST /api/v1/auth/register', () => {
  let app;
  const createdEmails = [];
  let userIndex = 0;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({
        where: {
          email: { in: createdEmails },
        },
      });
    }
    await prisma.$disconnect();
  });

  const trackEmail = (email) => {
    if (email && !createdEmails.includes(email.toLowerCase())) {
      createdEmails.push(email.toLowerCase());
    }
  };

  const generateUserData = (overrides = {}) => {
    userIndex += 1;
    const uniqueSuffix = `${Date.now()}_${userIndex}_${Math.floor(Math.random() * 1000000)}`;
    const email = `test_${uniqueSuffix}@test.invalid`;
    const randomDigits = Math.floor(100000000 + Math.random() * 900000000);
    const phone = `+1${randomDigits}${userIndex % 10}`;

    const data = {
      fullName: 'Jane Doe',
      email,
      phone,
      gender: Gender.FEMALE,
      password: 'Password123!',
      ...overrides,
    };

    trackEmail(data.email);

    return data;
  };

  it('registers a member with 201, lowercased email, normalized phone, and no passwordHash', async () => {
    const rawEmail = `TEST_${Date.now()}_MEMBER@test.invalid`;
    const payload = generateUserData({
      email: rawEmail,
      phone: '+1 (202) 555-0199',
      whatsappNumber: '+1 (202) 555-0198',
      birthDay: 15,
      birthMonth: 8,
    });
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.REGISTER_SUCCESS);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.fullName).toBe(payload.fullName);
    expect(res.body.data.email).toBe(rawEmail.toLowerCase());
    expect(res.body.data.phone).toBe('+12025550199');
    expect(res.body.data.whatsappNumber).toBe('+12025550198');
    expect(res.body.data.gender).toBe(Gender.FEMALE);
    expect(res.body.data.birthDay).toBe(15);
    expect(res.body.data.birthMonth).toBe(8);
    expect(res.body.data.role).toBe(Role.MEMBER);
    expect(res.body.data.status).toBe(AccountStatus.PENDING);
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('ignores client-sent role and status, enforcing MEMBER and PENDING', async () => {
    const payload = generateUserData({
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
    });
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe(Role.MEMBER);
    expect(res.body.data.status).toBe(AccountStatus.PENDING);

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });
    expect(dbUser.role).toBe(Role.MEMBER);
    expect(dbUser.status).toBe(AccountStatus.PENDING);
  });

  it('saves omitted optional fields as null', async () => {
    const payload = generateUserData();
    delete payload.whatsappNumber;
    delete payload.birthDay;
    delete payload.birthMonth;
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.whatsappNumber).toBeNull();
    expect(res.body.data.birthDay).toBeNull();
    expect(res.body.data.birthMonth).toBeNull();

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });
    expect(dbUser.whatsappNumber).toBeNull();
    expect(dbUser.birthDay).toBeNull();
    expect(dbUser.birthMonth).toBeNull();
  });

  it('accepts empty string and null for optional fields and stores them as null', async () => {
    const payload = generateUserData({
      whatsappNumber: '',
      birthDay: null,
      birthMonth: null,
    });
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.whatsappNumber).toBeNull();
    expect(res.body.data.birthDay).toBeNull();
    expect(res.body.data.birthMonth).toBeNull();
  });

  it('returns 409 User already exists when registering with an existing email', async () => {
    const userA = generateUserData();
    trackEmail(userA.email);
    const res1 = await request(app).post('/api/v1/auth/register').send(userA);
    expect(res1.status).toBe(201);

    const userB = generateUserData({ email: userA.email });
    const res2 = await request(app).post('/api/v1/auth/register').send(userB);

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.message).toBe(Messages.USER_ALREADY_EXISTS);
    expect(res2.body.code).toBe('USER_ALREADY_EXISTS');
  });

  it('answers an oversized body with 413 and a code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ fullName: 'x'.repeat(1024 * 1024 + 1) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      success: false,
      message: Messages.PAYLOAD_TOO_LARGE,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('allows registration with an existing phone number and a different email', async () => {
    const userA = generateUserData();
    const res1 = await request(app).post('/api/v1/auth/register').send(userA);
    expect(res1.status).toBe(201);

    const userB = generateUserData({ phone: userA.phone });
    const res2 = await request(app).post('/api/v1/auth/register').send(userB);

    expect(res2.status).toBe(201);
    expect(res2.body.success).toBe(true);
    expect(res2.body.message).toBe(Messages.REGISTER_SUCCESS);
    expect(res2.body.data.phone).toBe(res1.body.data.phone);
    expect(res2.body.data.email).toBe(userB.email.toLowerCase());
  });

  it('handles race conditions with exactly one 201 and one 409', async () => {
    const payload = generateUserData();

    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/auth/register').send(payload),
      request(app).post('/api/v1/auth/register').send(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const successRes = res1.status === 201 ? res1 : res2;
    const conflictRes = res1.status === 409 ? res1 : res2;

    expect(successRes.body.success).toBe(true);
    expect(conflictRes.body.success).toBe(false);
    expect(conflictRes.body.message).toBe(Messages.USER_ALREADY_EXISTS);
  });

  it('returns 400 for a weak password', async () => {
    const payload = generateUserData({ password: 'weak' });
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('returns 400 when fullName is missing', async () => {
    const payload = generateUserData();
    delete payload.fullName;
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('returns 400 for an invalid gender', async () => {
    const payload = generateUserData({ gender: 'INVALID_GENDER' });
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('returns 400 for an invalid phone number', async () => {
    const payload = generateUserData({ phone: '123' });
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('returns 400 when birthDay is provided without birthMonth', async () => {
    const payload = generateUserData({ birthDay: 15 });
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('returns 400 for impossible calendar date (April 31)', async () => {
    const payload = generateUserData({ birthMonth: 4, birthDay: 31 });
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
  });

  it('accepts Feb 29 as a valid birthday', async () => {
    const payload = generateUserData({ birthMonth: 2, birthDay: 29 });
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.birthMonth).toBe(2);
    expect(res.body.data.birthDay).toBe(29);
  });

  it('returns 400 when request body contains malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"fullName": "Broken JSON');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(Messages.MALFORMED_JSON);
  });

  it('stores the password as a bcrypt hash in the database', async () => {
    const plainPassword = 'Password123!';
    const payload = generateUserData({ password: plainPassword });
    trackEmail(payload.email);

    const res = await request(app).post('/api/v1/auth/register').send(payload);
    expect(res.status).toBe(201);

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });

    expect(dbUser).toBeDefined();
    expect(dbUser.passwordHash).toBeDefined();
    expect(dbUser.passwordHash).not.toBe(plainPassword);

    const isMatch = await bcrypt.compare(plainPassword, dbUser.passwordHash);
    expect(isMatch).toBe(true);
  });
});
