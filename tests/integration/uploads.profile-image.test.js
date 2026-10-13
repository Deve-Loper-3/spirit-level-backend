// Set before the app loads so the store id (teststore) used for URL checks is known.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Messages } = require('../../src/constants/messages');
const { createTestData } = require('../helpers/testData.helper');
const { bearerFor } = require('../helpers/auth.helper');

jest.setTimeout(30000);

const URL = '/api/v1/uploads/profile-image';
const IMAGE_URL =
  'https://teststore.public.blob.vercel-storage.com/profile-images/4d1c-photo-AbC123.png';

describe('PATCH /api/v1/uploads/profile-image', () => {
  const testData = createTestData('profileimage');
  let app;
  let user;

  beforeAll(async () => {
    app = createApp();
    user = await testData.createUser();
  });

  afterAll(async () => {
    await testData.cleanup();
    await prisma.$disconnect();
  });

  const patch = (body) => request(app).patch(URL).set('Authorization', bearerFor(user)).send(body);
  const storedUrl = async () =>
    (await prisma.user.findUnique({ where: { id: user.id } })).profileImageUrl;

  it('returns 401 without a token', async () => {
    const res = await request(app).patch(URL).send({ profileImageUrl: IMAGE_URL });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it.each([
    ['another store', IMAGE_URL.replace('teststore', 'otherstore')],
    ['a different folder', IMAGE_URL.replace('profile-images', 'other-folder')],
    ['a non-URL string', 'not-a-url'],
  ])('rejects %s with 400 and keeps the stored value', async (_label, profileImageUrl) => {
    const res = await patch({ profileImageUrl });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'profileImageUrl', message: Messages.IMAGE_URL_INVALID }),
    ]);
    expect(await storedUrl()).toBeNull();
  });

  it('rejects a body without profileImageUrl with 400', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
  });

  it('updates the image and returns the public user', async () => {
    const res = await patch({ profileImageUrl: IMAGE_URL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: Messages.PROFILE_IMAGE_UPDATED_SUCCESS,
      data: expect.objectContaining({ id: user.id, profileImageUrl: IMAGE_URL }),
    });
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(await storedUrl()).toBe(IMAGE_URL);
  });

  it.each([[null], ['']])('resets the image when profileImageUrl is %p', async (value) => {
    await patch({ profileImageUrl: IMAGE_URL });

    const res = await patch({ profileImageUrl: value });

    expect(res.status).toBe(200);
    expect(res.body.data.profileImageUrl).toBeNull();
    expect(await storedUrl()).toBeNull();
  });
});
