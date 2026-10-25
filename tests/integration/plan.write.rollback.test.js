// The audit insert is the LAST step of both plan write transactions. Forcing it to fail proves
// that the update (and the version bump made by the trigger) roll back with it.
jest.mock('../../src/repositories/audit-log.repository', () => ({
  createAuditLog: jest.fn().mockRejectedValue(new Error('audit unavailable')),
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');
const { deleteTestPlans, createTestPlan } = require('../helpers/membershipPlan.helper');

jest.setTimeout(60000);

describe('plan write transactions - rollback', () => {
  const PREFIX = 'test_slmp04_rb_';
  const testData = createTestData('slmp04_rb');
  let app;
  let admin;

  beforeAll(async () => {
    app = createApp();
    await deleteTestPlans(PREFIX);
    admin = await testData.createUser({ role: Role.ADMIN });
  });

  afterAll(async () => {
    await deleteTestPlans(PREFIX);
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const patch = (path, body) =>
    request(app).patch(path).set('Authorization', bearerFor(admin)).send(body);

  it('PATCH /plans/:id changes nothing, version included, when the audit insert fails', async () => {
    const plan = await createTestPlan(PREFIX);

    const res = await patch(`/api/v1/plans/${plan.id}`, { price: 999, description: 'changed' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
    const after = await prisma.membershipPlan.findUnique({ where: { id: plan.id } });
    expect(after.price.toNumber()).toBe(100);
    expect(after.description).toBe('original description');
    expect(after.version).toBe(1);
    expect(after.updatedAt).toEqual(plan.updatedAt);
  });

  it('PATCH /plans/:id/status changes nothing when the audit insert fails', async () => {
    const plan = await createTestPlan(PREFIX);

    const res = await patch(`/api/v1/plans/${plan.id}/status`, { status: 'archived' });

    expect(res.status).toBe(500);
    const after = await prisma.membershipPlan.findUnique({ where: { id: plan.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.updatedAt).toEqual(plan.updatedAt);
  });
});
