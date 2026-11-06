const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { Gender } = require('../../src/constants/gender');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { CoachType, CoachStatus } = require('../../src/constants/coach');

// Creates users directly in the DB and remembers every id/email so cleanup() removes all of it.
// Users that the API created for an email from newEmail() are removed too (matched by email).
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

  // A COACH user plus its Coach profile. Deleting the user in cleanup() removes the profile too.
  const createCoach = async ({ user: userOverrides = {}, coach: coachOverrides = {} } = {}) => {
    const user = await createUser({ role: Role.COACH, fullName: 'Seeded Coach', ...userOverrides });
    const coach = await prisma.coach.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        coachType: CoachType.SALARIED,
        status: CoachStatus.ACTIVE,
        ...coachOverrides,
      },
    });
    return { user, coach };
  };

  const cleanup = async () => {
    // Cafe orders RESTRICT user deletion; remove the test users' orders (items cascade) first.
    await prisma.cafeOrder.deleteMany({
      where: {
        createdBy: {
          OR: [
            { id: { in: userIds } },
            { email: { in: emails } },
            { email: { startsWith: `test_${label}_` } },
          ],
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { email: { in: emails } },
          { email: { startsWith: `test_${label}_` } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: userIds } },
          { email: { in: emails } },
          { email: { startsWith: `test_${label}_` } },
        ],
      },
    });
  };

  return { newEmail, createUser, createCoach, cleanup };
};

module.exports = { createTestData };
