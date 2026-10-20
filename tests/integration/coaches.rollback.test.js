// The audit insert is the LAST step of both coach write transactions. Forcing it to fail proves
// that the writes before it (user columns, coach columns, status, session revocation) roll back.
jest.mock('../../src/repositories/audit-log.repository', () => ({
  createAuditLog: jest.fn().mockRejectedValue(new Error('audit unavailable')),
}));

const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { CoachStatus } = require('../../src/constants/coach');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB (~300ms per query, ~1.6s per interactive transaction) exceeds jest's 5s default.
jest.setTimeout(60000);

describe('coach write transactions - rollback', () => {
  const testData = createTestData('coaches_rollback');
  let app;
  let admin;

  beforeAll(async () => {
    app = createApp();
    admin = await testData.createUser({ role: Role.ADMIN });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const seedCoach = () =>
    testData.createCoach({
      user: { fullName: 'Original Name' },
      coach: { bio: 'Original bio' },
    });

  const patch = (path, body) =>
    request(app).patch(path).set('Authorization', bearerFor(admin)).send(body);

  it('PATCH /coaches/:id changes neither the user nor the coach when the audit insert fails', async () => {
    const { user, coach } = await seedCoach();

    const res = await patch(`/api/v1/coaches/${coach.id}`, {
      fullName: 'Changed Name',
      email: testData.newEmail(),
      bio: 'Changed bio',
      coachType: 'FREELANCE',
    });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
    const userAfter = await prisma.user.findUnique({ where: { id: user.id } });
    const coachAfter = await prisma.coach.findUnique({ where: { id: coach.id } });
    expect(userAfter).toMatchObject({ fullName: 'Original Name', email: user.email });
    expect(coachAfter).toMatchObject({ bio: 'Original bio', coachType: 'SALARIED' });
    expect(coachAfter.updatedAt).toEqual(coach.updatedAt);
  });

  it('PATCH /coaches/:id/status changes no status and revokes no session when the audit insert fails', async () => {
    const { user, coach } = await seedCoach();
    const session = await prisma.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: `hash_${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    const res = await patch(`/api/v1/coaches/${coach.id}/status`, {
      status: CoachStatus.INACTIVE,
    });

    expect(res.status).toBe(500);
    expect((await prisma.coach.findUnique({ where: { id: coach.id } })).status).toBe(
      CoachStatus.ACTIVE,
    );
    expect((await prisma.user.findUnique({ where: { id: user.id } })).status).toBe(
      AccountStatus.ACTIVE,
    );
    expect(
      (await prisma.refreshSession.findUnique({ where: { id: session.id } })).revokedAt,
    ).toBeNull();
  });
});
