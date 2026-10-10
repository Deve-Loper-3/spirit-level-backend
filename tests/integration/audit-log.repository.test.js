const prisma = require('../../src/config/prisma');
const { recordLoginFailure } = require('../../src/repositories/audit-log.repository');
const { AuditAction, LoginFailureReason } = require('../../src/constants/audit');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

const META = { ipAddress: '198.51.100.23', userAgent: 'jest-agent/2.0' };

describe('audit-log.repository - recordLoginFailure', () => {
  const testData = createTestData('audit_failure');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const findLogByEmail = (email) => prisma.auditLog.findFirst({ where: { email } });

  it('records a LOGIN_FAILED row linked to the user when userId is given', async () => {
    const user = await testData.createUser();

    await recordLoginFailure({
      userId: user.id,
      email: user.email,
      reason: LoginFailureReason.ACCOUNT_PENDING,
      meta: META,
    });

    expect(await findLogByEmail(user.email)).toMatchObject({
      action: AuditAction.LOGIN_FAILED,
      userId: user.id,
      reason: LoginFailureReason.ACCOUNT_PENDING,
      email: user.email,
      ipAddress: META.ipAddress,
      userAgent: META.userAgent,
    });
  });

  it('records the attempted email with a NULL userId when no user matched', async () => {
    const email = testData.newEmail();

    await recordLoginFailure({
      email,
      reason: LoginFailureReason.INVALID_CREDENTIALS,
      meta: META,
    });

    expect(await findLogByEmail(email)).toMatchObject({
      action: AuditAction.LOGIN_FAILED,
      userId: null,
      reason: LoginFailureReason.INVALID_CREDENTIALS,
      email,
    });
  });

  it.each(Object.values(LoginFailureReason))('stores the failure reason %s', async (reason) => {
    const email = testData.newEmail();

    await recordLoginFailure({ email, reason, meta: META });

    expect((await findLogByEmail(email)).reason).toBe(reason);
  });

  it('stores NULL ip and user agent when meta is omitted', async () => {
    const email = testData.newEmail();

    await recordLoginFailure({ email, reason: LoginFailureReason.ACCOUNT_DISABLED });

    expect(await findLogByEmail(email)).toMatchObject({ ipAddress: null, userAgent: null });
  });
});
