// The Coach insert happens after the User insert inside one transaction. Forcing it to fail
// proves the user (and its audit row) are rolled back and no email goes out.
jest.mock('../../src/repositories/coach.repository', () => ({
  createCoachProfile: jest.fn().mockRejectedValue(new Error('coach insert failed')),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AuditAction } = require('../../src/constants/audit');
const { CoachType } = require('../../src/constants/coach');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

describe('POST /api/v1/admin/staff/coaches - transaction rollback', () => {
  const testData = createTestData('admin_staff_coaches_rollback');
  const coachEmail = testData.newEmail();

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('creates no user, no coach, no audit row and sends no email when the coach insert fails', async () => {
    const admin = await testData.createUser({ role: Role.ADMIN });

    const res = await request(createApp())
      .post('/api/v1/admin/staff/coaches')
      .set('Authorization', bearerFor(admin))
      .send({
        fullName: 'Rollback Coach',
        email: coachEmail,
        phone: '+12025550123',
        coachType: CoachType.SALARIED,
      });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await prisma.user.findUnique({ where: { email: coachEmail } })).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { email: coachEmail, action: AuditAction.STAFF_CREATED },
      }),
    ).toBe(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
