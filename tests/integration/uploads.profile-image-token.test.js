// Token signing is local crypto, so this suite needs neither the DB nor the Blob API.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');
const { getPayloadFromClientToken } = require('@vercel/blob/client');
const { createApp } = require('../../src/app');
const { Messages } = require('../../src/constants/messages');
const { MAX_IMAGE_SIZE_BYTES } = require('../../src/constants/upload');

const TOKEN_URL = '/api/v1/uploads/profile-image/token';

describe('POST /api/v1/uploads/profile-image/token', () => {
  const app = createApp();

  it('issues a short-lived client token and the upload instructions', async () => {
    const res = await request(app).post(TOKEN_URL).send({ contentType: 'image/png' });

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
    expect(upload.headers['x-content-type']).toBe('image/png');

    const payload = getPayloadFromClientToken(clientToken);
    expect(payload.pathname).toMatch(/^profile-images\/[0-9a-f-]{36}\.png$/);
    expect(payload.allowedContentTypes).toEqual(['image/png']);
    expect(payload.maximumSizeInBytes).toBe(MAX_IMAGE_SIZE_BYTES);
    expect(payload.validUntil).toBe(new Date(expiresAt).getTime());
    expect(upload.url).toContain(encodeURIComponent(payload.pathname));
  });

  it('never leaks the read-write token', async () => {
    const res = await request(app).post(TOKEN_URL).send({ contentType: 'image/webp' });

    expect(JSON.stringify(res.body)).not.toContain('fakesecret');
  });

  it('gives each request a different pathname', async () => {
    const [a, b] = await Promise.all([
      request(app).post(TOKEN_URL).send({ contentType: 'image/jpeg' }),
      request(app).post(TOKEN_URL).send({ contentType: 'image/jpeg' }),
    ]);

    const pathA = getPayloadFromClientToken(a.body.data.clientToken).pathname;
    const pathB = getPayloadFromClientToken(b.body.data.clientToken).pathname;
    expect(pathA).not.toBe(pathB);
  });

  it.each([['text/plain'], ['image/gif'], [''], [123], [undefined]])(
    'rejects contentType %p with 400',
    async (contentType) => {
      const res = await request(app).post(TOKEN_URL).send({ contentType });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(Messages.VALIDATION_FAILED);
      expect(res.body.errors[0].field).toBe('contentType');
    },
  );

  it('ignores a client-chosen pathname', async () => {
    const res = await request(app)
      .post(TOKEN_URL)
      .send({ contentType: 'image/png', pathname: '../../evil.png' });

    expect(res.status).toBe(200);
    const { pathname } = getPayloadFromClientToken(res.body.data.clientToken);
    expect(pathname).toMatch(/^profile-images\/[0-9a-f-]{36}\.png$/);
  });
});
