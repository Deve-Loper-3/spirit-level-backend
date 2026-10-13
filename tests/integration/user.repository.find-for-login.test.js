const prisma = require('../../src/config/prisma');
const { findForLogin } = require('../../src/repositories/user.repository');
const { AccountStatus } = require('../../src/constants/status');
const { createTestData } = require('../helpers/testData.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(30000);

describe('user.repository - findForLogin', () => {
  const testData = createTestData('find_for_login');

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('returns the user including passwordHash for an existing email', async () => {
    const user = await testData.createUser({ passwordHash: 'stored-hash-value' });

    const found = await findForLogin(user.email);

    expect(found).toMatchObject({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      passwordHash: 'stored-hash-value',
    });
  });

  it('returns null for an unknown email', async () => {
    expect(await findForLogin(testData.newEmail())).toBeNull();
  });

  it('returns the stored status so login policies can be applied', async () => {
    const user = await testData.createUser({ status: AccountStatus.PENDING });

    const found = await findForLogin(user.email);

    expect(found.status).toBe(AccountStatus.PENDING);
  });

  it('selects only the fields login needs', async () => {
    const user = await testData.createUser();

    const found = await findForLogin(user.email);

    expect(Object.keys(found).sort()).toEqual(
      [
        'id',
        'fullName',
        'email',
        'phone',
        'whatsappNumber',
        'gender',
        'birthDay',
        'birthMonth',
        'profileImageUrl',
        'role',
        'status',
        'createdAt',
        'passwordHash',
      ].sort(),
    );
  });

  it('matches the email exactly (callers pass the normalized lowercase email)', async () => {
    const user = await testData.createUser();

    expect(await findForLogin(user.email.toUpperCase())).toBeNull();
  });
});
