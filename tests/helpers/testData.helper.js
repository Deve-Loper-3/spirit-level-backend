const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { Gender } = require('../../src/constants/gender');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');

// Creates users directly in the DB and remembers every id/email so cleanup() removes all of it.
// Audit rows are deleted explicitly: AuditLog.userId is SET NULL on user delete, so rows would be orphaned.
const createTestData = (label) => {
  const userIds = [];
  const emails = [];
  let counter = 0;

  const nextSuffix = () => {
    counter += 1;
    return `${Date.now()}_${counter}_${Math.floor(Math.random() * 1000000)}`;
  };

  const newEmail = () => {
    const email = `test_${label}_${nextSuffix()}@test.invalid`;
    emails.push(email);
    return email;
  };

  const createUser = async (overrides = {}) => {
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        fullName: 'Repository Test',
        email: newEmail(),
        phone: `+9${nextSuffix().replace(/_/g, '')}`,
        gender: Gender.MALE,
        passwordHash: 'not-a-real-hash',
        role: Role.MEMBER,
        status: AccountStatus.ACTIVE,
        ...overrides,
      },
    });
    userIds.push(user.id);
    return user;
  };

  const cleanup = async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { email: { in: emails } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  };

  return { newEmail, createUser, cleanup };
};

module.exports = { createTestData };
