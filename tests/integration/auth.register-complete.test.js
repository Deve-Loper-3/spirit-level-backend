const request = require('supertest');
const crypto = require('crypto');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');
const { Relationship } = require('../../src/constants/relationship');
const { Messages } = require('../../src/constants/messages');
const { AppErrors } = require('../../src/constants/errors');

describe('POST /api/v1/auth/register/complete', () => {
  let app;
  const createdUserIds = [];
  let userIndex = 0;
  let contactIndex = 0;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: { in: createdUserIds },
        },
      });
    }
    await prisma.$disconnect();
  });

  const createPendingMember = async (overrides = {}) => {
    userIndex += 1;
    const uniqueSuffix = `${Date.now()}_${userIndex}_${Math.floor(Math.random() * 1000000)}`;
    const email = `test_complete_${uniqueSuffix}@test.invalid`;
    const randomDigits = Math.floor(100000000 + Math.random() * 900000000);
    const phone = `+1${randomDigits}${userIndex % 10}`;

    const regPayload = {
      fullName: 'Jane Doe',
      email,
      phone,
      gender: Gender.FEMALE,
      password: 'Password123!',
      ...overrides,
    };

    const res = await request(app).post('/api/v1/auth/register').send(regPayload);
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.data.id);

    return {
      id: res.body.data.id,
      email: res.body.data.email,
      phone: res.body.data.phone,
    };
  };

  const generateEmergencyContact = (overrides = {}) => {
    contactIndex += 1;
    const randomDigits = Math.floor(100000000 + Math.random() * 900000000);
    return {
      name: 'John Emergency',
      phone: `+1${randomDigits}${contactIndex % 10}`,
      relationship: Relationship.SPOUSE,
      ...overrides,
    };
  };

  it('completes registration for PENDING member (200), activates account and saves contact', async () => {
    const member = await createPendingMember();
    const contactData = generateEmergencyContact({
      name: '  John Smith  ',
      phone: '+1 (202) 555-0199',
      relationship: Relationship.SPOUSE,
    });

    const payload = {
      registrationId: member.id,
      emergencyContact: contactData,
      waiverAccepted: true,
      extraClientField: 'must-be-stripped',
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.REGISTRATION_COMPLETE_SUCCESS);

    expect(Object.keys(res.body.data).sort()).toEqual(['id', 'registrationCompletedAt', 'status']);
    expect(res.body.data.id).toBe(member.id);
    expect(res.body.data.status).toBe(AccountStatus.ACTIVE);
    expect(res.body.data.registrationCompletedAt).toBeDefined();

    const dbUser = await prisma.user.findUnique({
      where: { id: member.id },
      include: { emergencyContact: true },
    });

    expect(dbUser.status).toBe(AccountStatus.ACTIVE);
    expect(dbUser.waiverAcceptedAt).toBeDefined();
    expect(dbUser.registrationCompletedAt).toBeDefined();
    expect(dbUser.waiverAcceptedAt.getTime()).toBe(dbUser.registrationCompletedAt.getTime());

    expect(dbUser.emergencyContact).toBeDefined();
    expect(dbUser.emergencyContact.userId).toBe(member.id);
    expect(dbUser.emergencyContact.name).toBe('John Smith');
    expect(dbUser.emergencyContact.phone).toBe('+12025550199');
    expect(dbUser.emergencyContact.relationship).toBe(Relationship.SPOUSE);
  }, 15000);

  it('completes registration with phone only (name and relationship omitted), storing nulls in DB', async () => {
    const member = await createPendingMember();
    const contactData = generateEmergencyContact({ phone: '+12025550188' });
    delete contactData.name;
    delete contactData.relationship;

    const payload = {
      registrationId: member.id,
      emergencyContact: contactData,
      waiverAccepted: true,
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.REGISTRATION_COMPLETE_SUCCESS);
    expect(res.body.data.id).toBe(member.id);
    expect(res.body.data.status).toBe(AccountStatus.ACTIVE);

    const dbUser = await prisma.user.findUnique({
      where: { id: member.id },
      include: { emergencyContact: true },
    });

    expect(dbUser.status).toBe(AccountStatus.ACTIVE);
    expect(dbUser.emergencyContact).toBeDefined();
    expect(dbUser.emergencyContact.phone).toBe('+12025550188');
    expect(dbUser.emergencyContact.name).toBeNull();
    expect(dbUser.emergencyContact.relationship).toBeNull();
  }, 15000);

  it('completes registration when name is empty/whitespace string, storing null in DB', async () => {
    const member = await createPendingMember();
    const contactData = generateEmergencyContact({
      name: '   ',
      phone: '+12025550177',
      relationship: null,
    });

    const payload = {
      registrationId: member.id,
      emergencyContact: contactData,
      waiverAccepted: true,
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbUser = await prisma.user.findUnique({
      where: { id: member.id },
      include: { emergencyContact: true },
    });

    expect(dbUser.status).toBe(AccountStatus.ACTIVE);
    expect(dbUser.emergencyContact).toBeDefined();
    expect(dbUser.emergencyContact.phone).toBe('+12025550177');
    expect(dbUser.emergencyContact.name).toBeNull();
    expect(dbUser.emergencyContact.relationship).toBeNull();
  }, 15000);

  describe('400 validation error cases', () => {
    it('returns 400 when emergencyContact.name is shorter than 2 characters (short name)', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        emergencyContact: generateEmergencyContact({ name: 'A' }),
        waiverAccepted: true,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'emergencyContact.name',
            message: Messages.EMERGENCY_NAME_MIN_LENGTH,
          }),
        ]),
      );
    });

    it('returns 400 when registrationId is not a valid UUID', async () => {
      const payload = {
        registrationId: 'invalid-uuid-string',
        emergencyContact: generateEmergencyContact(),
        waiverAccepted: true,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'registrationId',
            message: Messages.REGISTRATION_ID_INVALID,
          }),
        ]),
      );
    });

    it('returns 400 when waiverAccepted is false', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        emergencyContact: generateEmergencyContact(),
        waiverAccepted: false,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'waiverAccepted',
            message: Messages.WAIVER_MUST_BE_ACCEPTED,
          }),
        ]),
      );
    });

    it('returns 400 when waiverAccepted is omitted', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        emergencyContact: generateEmergencyContact(),
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'waiverAccepted',
            message: Messages.WAIVER_MUST_BE_ACCEPTED,
          }),
        ]),
      );
    });

    it('returns 400 when emergency contact phone format is invalid', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        emergencyContact: generateEmergencyContact({ phone: '123' }),
        waiverAccepted: true,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'emergencyContact.phone',
            message: Messages.EMERGENCY_PHONE_INVALID,
          }),
        ]),
      );
    });

    it('returns 400 when relationship value is invalid', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        emergencyContact: generateEmergencyContact({ relationship: 'COWORKER' }),
        waiverAccepted: true,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'emergencyContact.relationship',
            message: Messages.EMERGENCY_RELATIONSHIP_INVALID,
          }),
        ]),
      );
    });

    it('returns 400 when emergencyContact is omitted', async () => {
      const member = await createPendingMember();
      const payload = {
        registrationId: member.id,
        waiverAccepted: true,
      };

      const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'emergencyContact',
            message: Messages.EMERGENCY_CONTACT_REQUIRED,
          }),
        ]),
      );
    });
  });

  it('returns 400 when emergency phone equals the member own phone and leaves DB unchanged', async () => {
    const member = await createPendingMember();
    const payload = {
      registrationId: member.id,
      emergencyContact: generateEmergencyContact({ phone: member.phone }),
      waiverAccepted: true,
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.statusCode);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER.message);

    const dbUser = await prisma.user.findUnique({
      where: { id: member.id },
      include: { emergencyContact: true },
    });

    expect(dbUser.status).toBe(AccountStatus.PENDING);
    expect(dbUser.waiverAcceptedAt).toBeNull();
    expect(dbUser.registrationCompletedAt).toBeNull();
    expect(dbUser.emergencyContact).toBeNull();
  }, 15000);

  it('returns 404 when valid UUID does not exist in the database', async () => {
    const nonExistentId = crypto.randomUUID();
    const payload = {
      registrationId: nonExistentId,
      emergencyContact: generateEmergencyContact(),
      waiverAccepted: true,
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(AppErrors.USER_NOT_FOUND.statusCode);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(AppErrors.USER_NOT_FOUND.message);
  }, 15000);

  it('returns 409 on second completion and preserves first completion timestamp and single contact', async () => {
    const member = await createPendingMember();
    const payload = {
      registrationId: member.id,
      emergencyContact: generateEmergencyContact(),
      waiverAccepted: true,
    };

    const firstRes = await request(app).post('/api/v1/auth/register/complete').send(payload);
    expect(firstRes.status).toBe(200);

    const firstCompletedAt = firstRes.body.data.registrationCompletedAt;

    const secondRes = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(secondRes.status).toBe(AppErrors.REGISTRATION_ALREADY_COMPLETED.statusCode);
    expect(secondRes.body.success).toBe(false);
    expect(secondRes.body.message).toBe(AppErrors.REGISTRATION_ALREADY_COMPLETED.message);

    const dbUser = await prisma.user.findUnique({
      where: { id: member.id },
      include: { emergencyContact: true },
    });

    expect(dbUser.status).toBe(AccountStatus.ACTIVE);
    expect(new Date(dbUser.registrationCompletedAt).toISOString()).toBe(
      new Date(firstCompletedAt).toISOString(),
    );

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: member.id },
    });
    expect(contacts.length).toBe(1);
  }, 15000);

  it('returns 403 when member is DISABLED', async () => {
    const member = await createPendingMember();

    await prisma.user.update({
      where: { id: member.id },
      data: { status: AccountStatus.DISABLED },
    });

    const payload = {
      registrationId: member.id,
      emergencyContact: generateEmergencyContact(),
      waiverAccepted: true,
    };

    const res = await request(app).post('/api/v1/auth/register/complete').send(payload);

    expect(res.status).toBe(AppErrors.ACCOUNT_NOT_ELIGIBLE.statusCode);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(AppErrors.ACCOUNT_NOT_ELIGIBLE.message);
  }, 15000);

  it('handles concurrency gracefully with exactly one 200 and one 409, saving one contact', async () => {
    const member = await createPendingMember();
    const payload = {
      registrationId: member.id,
      emergencyContact: generateEmergencyContact(),
      waiverAccepted: true,
    };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/auth/register/complete').send(payload),
      request(app).post('/api/v1/auth/register/complete').send(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successRes = res1.status === 200 ? res1 : res2;
    const conflictRes = res1.status === 409 ? res1 : res2;

    expect(successRes.body.success).toBe(true);
    expect(successRes.body.message).toBe(Messages.REGISTRATION_COMPLETE_SUCCESS);

    expect(conflictRes.body.success).toBe(false);
    expect(conflictRes.body.message).toBe(AppErrors.REGISTRATION_ALREADY_COMPLETED.message);

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: member.id },
    });
    expect(contacts.length).toBe(1);
  }, 15000);
});
