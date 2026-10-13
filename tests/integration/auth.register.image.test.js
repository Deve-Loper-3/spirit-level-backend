const mockDel = jest.fn();

jest.mock('@vercel/blob', () => ({ del: (...args) => mockDel(...args) }));

// Set before the app loads so the store id (teststore) used for URL checks is known.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { Gender } = require('../../src/constants/gender');
const { Messages } = require('../../src/constants/messages');

jest.setTimeout(30000);

const REGISTER_URL = '/api/v1/auth/register';
const IMAGE_URL =
  'https://teststore.public.blob.vercel-storage.com/profile-images/4d1c-photo-AbC123.png';

describe('POST /api/v1/auth/register with profileImageUrl (JSON)', () => {
  let app;
  const createdEmails = [];
  let counter = 0;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await prisma.$disconnect();
  });

  const buildPayload = (overrides = {}) => {
    counter += 1;
    const suffix = `${Date.now()}_${counter}_${Math.floor(Math.random() * 1000000)}`;
    const digits = Math.floor(100000000 + Math.random() * 900000000);
    const payload = {
      fullName: 'Jane Doe',
      email: `test_img_${suffix}@test.invalid`,
      phone: `+1${digits}${counter % 10}`,
      gender: Gender.FEMALE,
      password: 'Password123!',
      ...overrides,
    };
    createdEmails.push(payload.email.toLowerCase());
    return payload;
  };

  const register = (payload) => request(app).post(REGISTER_URL).send(payload);
  const findUser = (email) => prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  it('stores the submitted image URL and returns it', async () => {
    const payload = buildPayload({ profileImageUrl: IMAGE_URL });

    const res = await register(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.profileImageUrl).toBe(IMAGE_URL);
    expect((await findUser(payload.email)).profileImageUrl).toBe(IMAGE_URL);
  });

  it('registers without an image, profileImageUrl null', async () => {
    const payload = buildPayload();

    const res = await register(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.profileImageUrl).toBeNull();
    expect((await findUser(payload.email)).profileImageUrl).toBeNull();
  });

  it.each([[''], [null]])('treats profileImageUrl %p as no image', async (value) => {
    const payload = buildPayload({ profileImageUrl: value });

    const res = await register(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.profileImageUrl).toBeNull();
  });

  it.each([
    ['another store', IMAGE_URL.replace('teststore', 'otherstore')],
    ['http scheme', IMAGE_URL.replace('https', 'http')],
    ['a non-blob host', 'https://evil.example.com/profile-images/a.png'],
    ['a different folder', IMAGE_URL.replace('profile-images', 'other-folder')],
    ['a non-URL string', 'not-a-url'],
  ])('rejects %s with 400 and creates nothing', async (_label, profileImageUrl) => {
    const payload = buildPayload({ profileImageUrl });

    const res = await register(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'profileImageUrl', message: Messages.IMAGE_URL_INVALID }),
    ]);
    expect(await findUser(payload.email)).toBeNull();
  });

  it('returns 409 for an existing email and never deletes the submitted URL', async () => {
    const payload = buildPayload();
    expect((await register(payload)).status).toBe(201);

    const res = await register({ ...payload, profileImageUrl: IMAGE_URL });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(Messages.USER_ALREADY_EXISTS);
    expect(mockDel).not.toHaveBeenCalled();
    expect((await findUser(payload.email)).profileImageUrl).toBeNull();
  });

  it('ignores client-sent role and status fields', async () => {
    const payload = buildPayload({
      profileImageUrl: IMAGE_URL,
      role: Role.OWNER,
      status: AccountStatus.ACTIVE,
    });

    const res = await register(payload);

    expect(res.status).toBe(201);
    const row = await findUser(payload.email);
    expect(row.role).toBe(Role.MEMBER);
    expect(row.status).toBe(AccountStatus.PENDING);
  });
});
