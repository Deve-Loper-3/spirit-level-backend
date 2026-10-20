const crypto = require('crypto');
const prisma = require('../../src/config/prisma');
const { sweepStaleTestData, STALE_AFTER_MS } = require('../helpers/sweepTestData');
const { Role } = require('../../src/constants/roles');
const { Gender } = require('../../src/constants/gender');
const { AccountStatus } = require('../../src/constants/status');
const { AuditAction } = require('../../src/constants/audit');
const { CoachType, CoachStatus } = require('../../src/constants/coach');

// Remote DB: each query takes a while, jest's 5s default is too short.
jest.setTimeout(60000);

describe('sweepStaleTestData', () => {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  const now = new Date();
  const old = new Date(now.getTime() - STALE_AFTER_MS - 60 * 1000);
  const ids = [];

  const makeUser = async (email, createdAt) => {
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        fullName: 'Sweep Test',
        email,
        phone: '+19990000000',
        gender: Gender.MALE,
        passwordHash: 'not-a-real-hash',
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
        createdAt,
      },
    });
    ids.push(user.id);
    return user;
  };

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { email: { contains: stamp } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('deletes old test users with their coach, sessions and audit rows, and nothing else', async () => {
    const staleTest = await makeUser(`test_sweep_${stamp}_old@test.invalid`, old);
    const freshTest = await makeUser(`test_sweep_${stamp}_fresh@test.invalid`, now);
    const oldWrongPrefix = await makeUser(`real_sweep_${stamp}@test.invalid`, old);
    const oldWrongSuffix = await makeUser(`test_sweep_${stamp}@example.com`, old);
    await prisma.coach.create({
      data: {
        id: crypto.randomUUID(),
        userId: staleTest.id,
        coachType: CoachType.SALARIED,
        status: CoachStatus.ACTIVE,
      },
    });
    await prisma.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId: staleTest.id,
        tokenHash: `sweep_${crypto.randomUUID()}`,
        expiresAt: new Date(now.getTime() + 3600 * 1000),
      },
    });
    await prisma.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: staleTest.id,
        action: AuditAction.LOGIN_SUCCESS,
        email: staleTest.email,
        createdAt: old,
      },
    });

    const deleted = await sweepStaleTestData(prisma, now);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    expect(remaining.map((u) => u.id).sort()).toEqual(
      [freshTest.id, oldWrongPrefix.id, oldWrongSuffix.id].sort(),
    );
    expect(await prisma.coach.count({ where: { userId: staleTest.id } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: staleTest.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { email: staleTest.email } })).toBe(0);
  });

  it('is repeatable: a second sweep finds nothing of ours', async () => {
    await sweepStaleTestData(prisma, now);

    expect(await prisma.user.count({ where: { email: { contains: `${stamp}_old` } } })).toBe(0);
  });
});
