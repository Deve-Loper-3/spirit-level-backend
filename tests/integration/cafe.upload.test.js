process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');
const { getPayloadFromClientToken } = require('@vercel/blob/client');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');
const { MAX_IMAGE_SIZE_BYTES } = require('../../src/constants/upload');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

jest.setTimeout(30000);

const UPLOAD_TOKEN_URL = '/api/v1/cafe/uploads/image/token';

describe('POST /api/v1/cafe/uploads/image/token', () => {
  const testData = createTestData('cafe_upload');
  let app;
  let adminUser;
  let ownerUser;
  let coachUser;
  let memberUser;

  beforeAll(async () => {
    app = createApp();
    adminUser = await testData.createUser({ role: Role.ADMIN, fullName: 'Admin Uploader' });
    ownerUser = await testData.createUser({ role: Role.OWNER, fullName: 'Owner Uploader' });
    coachUser = await testData.createUser({ role: Role.COACH, fullName: 'Coach Uploader' });
    memberUser = await testData.createUser({ role: Role.MEMBER, fullName: 'Member Uploader' });
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post(UPLOAD_TOKEN_URL).send({ contentType: 'image/png' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects unauthorized roles (COACH, MEMBER) with 403', async () => {
    const coachRes = await request(app)
      .post(UPLOAD_TOKEN_URL)
      .set('Authorization', bearerFor(coachUser))
      .send({ contentType: 'image/png' });
    expect(coachRes.status).toBe(403);

    const memberRes = await request(app)
      .post(UPLOAD_TOKEN_URL)
      .set('Authorization', bearerFor(memberUser))
      .send({ contentType: 'image/png' });
    expect(memberRes.status).toBe(403);
  });

  it.each([['text/plain'], ['image/gif'], [''], [123], [undefined]])(
    'rejects invalid contentType %p with 400',
    async (contentType) => {
      const res = await request(app)
        .post(UPLOAD_TOKEN_URL)
        .set('Authorization', bearerFor(adminUser))
        .send({ contentType });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'contentType',
            message: Messages.IMAGE_TYPE_NOT_ALLOWED,
          }),
        ]),
      );
    },
  );

  it('issues a client token under cafe-items/ for OWNER and ADMIN (200)', async () => {
    const res = await request(app)
      .post(UPLOAD_TOKEN_URL)
      .set('Authorization', bearerFor(adminUser))
      .send({ contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(Messages.IMAGE_UPLOAD_TOKEN_ISSUED);

    const { clientToken, expiresAt, maxSizeBytes, allowedContentTypes, upload } = res.body.data;
    expect(clientToken).toMatch(/^vercel_blob_client_teststore_/);
    expect(maxSizeBytes).toBe(MAX_IMAGE_SIZE_BYTES);
    expect(allowedContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(upload.method).toBe('PUT');
    expect(upload.headers.authorization).toBe(`Bearer ${clientToken}`);
    expect(upload.headers['x-content-type']).toBe('image/jpeg');

    const payload = getPayloadFromClientToken(clientToken);
    expect(payload.pathname).toMatch(/^cafe-items\/[0-9a-f-]{36}\.jpg$/);
    expect(payload.allowedContentTypes).toEqual(['image/jpeg']);
    expect(payload.maximumSizeInBytes).toBe(MAX_IMAGE_SIZE_BYTES);
    expect(payload.validUntil).toBe(new Date(expiresAt).getTime());
    expect(upload.url).toContain(encodeURIComponent(payload.pathname));
  });

  it('allows OWNER to issue upload token', async () => {
    const res = await request(app)
      .post(UPLOAD_TOKEN_URL)
      .set('Authorization', bearerFor(ownerUser))
      .send({ contentType: 'image/webp' });

    expect(res.status).toBe(200);
    const payload = getPayloadFromClientToken(res.body.data.clientToken);
    expect(payload.pathname).toMatch(/^cafe-items\/[0-9a-f-]{36}\.webp$/);
  });

  it('returns 405 on disallowed methods on /uploads/image/token', async () => {
    const getRes = await request(app)
      .get(UPLOAD_TOKEN_URL)
      .set('Authorization', bearerFor(adminUser));

    expect(getRes.status).toBe(405);
    expect(getRes.headers.allow).toBe('POST');
  });
});
