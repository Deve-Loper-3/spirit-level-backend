// The STAFF_CREATED audit insert is the LAST step of the staff transaction. Forcing it to fail
// proves the user insert before it is rolled back too.
jest.mock('../../src/repositories/audit-log.repository', () => ({
  createAuditLog: jest.fn().mockRejectedValue(new Error('audit unavailable')),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

describe('POST /api/v1/admin/staff - transaction rollback', () => {
  const testData = createTestData('admin_staff_rollback');
  const staffEmail = testData.newEmail();

  afterAll(async () => {
    await testData.cleanup();
    await prisma.user.deleteMany({ where: { email: staffEmail } });
    await prisma.$disconnect();
  });

  it('does not create the user (and sends no email) when the audit insert fails', async () => {
    const admin = await testData.createUser({ role: Role.ADMIN });

    const res = await request(createApp())
      .post('/api/v1/admin/staff')
      .set('Authorization', bearerFor(admin))
      .send({
        fullName: 'Rollback Staff',
        email: staffEmail,
        phone: '+12025550123',
        role: Role.ADMIN,
      });

    expect(res.status).toBe(500);
    expect(await prisma.user.findUnique({ where: { email: staffEmail } })).toBeNull();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
