const request = require('supertest');

const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

// Remote DB: each request takes a while, jest's 5s default is too short.
jest.setTimeout(30000);

const STAFF_URL = '/api/v1/admin/staff';
const ME_URL = '/api/v1/auth/me';

// The role must come from the verified token's user in the DB, never from anything the client adds.
describe('client-sent role is ignored', () => {
  const testData = createTestData('client_role');
  let app;
  let member;

  beforeAll(async () => {
    app = createApp();
    member = await testData.createUser({ role: Role.MEMBER });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const staffBody = () => ({
    fullName: 'Forged Role',
    email: testData.newEmail(),
    phone: '+12025551234',
    role: Role.COACH,
  });

  describe('POST /admin/staff as a MEMBER', () => {
    it.each([
      ['x-user-role header', (req) => req.set('x-user-role', Role.OWNER)],
      ['role header', (req) => req.set('role', Role.ADMIN)],
      ['role query parameter', (req) => req.query({ role: Role.ADMIN })],
    ])('returns 403 with a forged %s', async (_label, forge) => {
      const body = staffBody();
      const req = request(app).post(STAFF_URL).set('Authorization', bearerFor(member));

      const res = await forge(req).send(body);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.FORBIDDEN });
      expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
    });

    it('returns 403 even if the token claims ADMIN but the DB role is MEMBER', async () => {
      const forgedBearer = bearerFor({ id: member.id, role: Role.ADMIN });

      const res = await request(app)
        .post(STAFF_URL)
        .set('Authorization', forgedBearer)
        .send(staffBody());

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, message: Messages.FORBIDDEN });
    });
  });

  describe('GET /auth/me as a MEMBER', () => {
    it.each([
      ['x-user-role header', (req) => req.set('x-user-role', Role.OWNER)],
      ['role query parameter', (req) => req.query({ role: Role.OWNER })],
      ['role body field', (req) => req.send({ role: Role.OWNER })],
    ])('still reports the DB role with a forged %s', async (_label, forge) => {
      const req = request(app).get(ME_URL).set('Authorization', bearerFor(member));

      const res = await forge(req);

      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe(Role.MEMBER);
    });
  });
});
