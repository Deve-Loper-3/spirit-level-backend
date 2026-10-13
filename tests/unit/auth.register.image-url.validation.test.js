jest.mock('../../src/infra/storage/blob.storage', () => ({
  isTrustedImageUrl: jest.fn(),
}));

const { registerSchema } = require('../../src/validators/auth.validation');
const { isTrustedImageUrl } = require('../../src/infra/storage/blob.storage');
const { Messages } = require('../../src/constants/messages');

const validPayload = () => ({
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+12025550100',
  gender: 'FEMALE',
  password: 'Password123!',
});
const URL_OK = 'https://store.public.blob.vercel-storage.com/profile-images/a.png';

describe('registerSchema - profileImageUrl', () => {
  beforeEach(() => {
    isTrustedImageUrl.mockReturnValue(true);
  });

  it('is optional', () => {
    const result = registerSchema.safeParse(validPayload());

    expect(result.success).toBe(true);
    expect(result.data.profileImageUrl).toBeUndefined();
    expect(isTrustedImageUrl).not.toHaveBeenCalled();
  });

  it.each([[''], ['   '], [null]])('treats %p as absent', (value) => {
    const result = registerSchema.safeParse({ ...validPayload(), profileImageUrl: value });

    expect(result.success).toBe(true);
    expect(result.data.profileImageUrl).toBeUndefined();
  });

  it('accepts a trusted URL and trims it', () => {
    const result = registerSchema.safeParse({ ...validPayload(), profileImageUrl: ` ${URL_OK} ` });

    expect(result.success).toBe(true);
    expect(result.data.profileImageUrl).toBe(URL_OK);
    expect(isTrustedImageUrl).toHaveBeenCalledWith(URL_OK);
  });

  it('rejects an untrusted URL with IMAGE_URL_INVALID', () => {
    isTrustedImageUrl.mockReturnValue(false);

    const result = registerSchema.safeParse({ ...validPayload(), profileImageUrl: URL_OK });

    expect(result.success).toBe(false);
    const issue = result.error.issues.find((i) => i.path.join('.') === 'profileImageUrl');
    expect(issue.message).toBe(Messages.IMAGE_URL_INVALID);
  });

  it('rejects a non-string value and a URL over 2048 characters', () => {
    const nonString = registerSchema.safeParse({ ...validPayload(), profileImageUrl: 123 });
    const tooLong = registerSchema.safeParse({
      ...validPayload(),
      profileImageUrl: `https://x.test/${'a'.repeat(2048)}`,
    });

    expect(nonString.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });
});
