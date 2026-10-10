jest.mock('@vercel/blob', () => ({ del: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
jest.mock('../../src/config/env', () => ({
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_Store123_secret',
}));
jest.mock('../../src/config/logger', () => ({ error: jest.fn(), warn: jest.fn() }));

const { del } = require('@vercel/blob');
const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
const env = require('../../src/config/env');
const logger = require('../../src/config/logger');
const {
  createImageUploadToken,
  isTrustedImageUrl,
  deleteImage,
} = require('../../src/infra/storage/blob.storage');
const { MAX_IMAGE_SIZE_BYTES } = require('../../src/constants/upload');

const TOKEN = 'vercel_blob_rw_Store123_secret';
const GOOD_URL = 'https://store123.public.blob.vercel-storage.com/profile-images/a1-xyz.png';

describe('blob.storage', () => {
  beforeEach(() => {
    env.BLOB_READ_WRITE_TOKEN = TOKEN;
    generateClientTokenFromReadWriteToken.mockResolvedValue('client-token');
  });

  describe('createImageUploadToken', () => {
    it('signs a token limited to a server-chosen pathname, the content type, size and time', async () => {
      const before = Date.now();

      const result = await createImageUploadToken('image/png');

      const args = generateClientTokenFromReadWriteToken.mock.calls[0][0];
      expect(args.token).toBe(TOKEN);
      expect(args.pathname).toMatch(/^profile-images\/[0-9a-f-]{36}\.png$/);
      expect(args.allowedContentTypes).toEqual(['image/png']);
      expect(args.maximumSizeInBytes).toBe(MAX_IMAGE_SIZE_BYTES);
      expect(args.addRandomSuffix).toBe(true);
      expect(args.validUntil).toBeGreaterThan(before);
      expect(args.validUntil - before).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);

      expect(result.clientToken).toBe('client-token');
      expect(result.expiresAt).toBe(new Date(args.validUntil).toISOString());
      expect(result.maxSizeBytes).toBe(MAX_IMAGE_SIZE_BYTES);
      expect(result.allowedContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      expect(result.upload.method).toBe('PUT');
      expect(result.upload.url).toBe(
        `https://vercel.com/api/blob/?pathname=${encodeURIComponent(args.pathname)}`,
      );
      expect(result.upload.headers).toEqual({
        authorization: 'Bearer client-token',
        'x-api-version': '12',
        'x-vercel-blob-access': 'public',
        'x-content-type': 'image/png',
        'x-add-random-suffix': '1',
      });
    });

    it.each([
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
    ])('uses the %s extension from the mimetype map', async (contentType, extension) => {
      await createImageUploadToken(contentType);

      const { pathname } = generateClientTokenFromReadWriteToken.mock.calls[0][0];
      expect(pathname.endsWith(`.${extension}`)).toBe(true);
    });

    it('never exposes the read-write token in the result', async () => {
      const result = await createImageUploadToken('image/png');

      expect(JSON.stringify(result)).not.toContain(TOKEN);
    });

    it('throws 503 when the token is not configured', async () => {
      env.BLOB_READ_WRITE_TOKEN = undefined;

      await expect(createImageUploadToken('image/png')).rejects.toMatchObject({
        statusCode: 503,
        code: 'IMAGE_UPLOAD_NOT_CONFIGURED',
      });
      expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
    });

    it('throws 400 for a content type outside the allow-list', async () => {
      await expect(createImageUploadToken('text/plain')).rejects.toMatchObject({
        statusCode: 400,
        code: 'IMAGE_TYPE_NOT_ALLOWED',
      });
    });

    it('logs the real error and throws a generic 502 when signing fails', async () => {
      generateClientTokenFromReadWriteToken.mockRejectedValue(new Error('signing broke'));

      await expect(createImageUploadToken('image/png')).rejects.toMatchObject({
        statusCode: 502,
        code: 'IMAGE_UPLOAD_TOKEN_FAILED',
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('isTrustedImageUrl', () => {
    it('accepts an https URL from our store under profile-images (host case-insensitive)', () => {
      expect(isTrustedImageUrl(GOOD_URL)).toBe(true);
      expect(isTrustedImageUrl(GOOD_URL.replace('store123', 'STORE123'))).toBe(true);
    });

    it.each([
      ['http scheme', GOOD_URL.replace('https', 'http')],
      ['other store', GOOD_URL.replace('store123', 'otherstore')],
      ['other host', 'https://evil.example.com/profile-images/a.png'],
      [
        'suffix trick',
        'https://store123.public.blob.vercel-storage.com.evil.com/profile-images/a.png',
      ],
      ['wrong folder', 'https://store123.public.blob.vercel-storage.com/other/a.png'],
      [
        'credentials',
        'https://user:pw@store123.public.blob.vercel-storage.com/profile-images/a.png',
      ],
      ['port', 'https://store123.public.blob.vercel-storage.com:8443/profile-images/a.png'],
      ['not a URL', 'not-a-url'],
    ])('rejects %s', (_label, url) => {
      expect(isTrustedImageUrl(url)).toBe(false);
    });

    it('falls back to the blob host suffix when no token is configured', () => {
      env.BLOB_READ_WRITE_TOKEN = undefined;

      expect(isTrustedImageUrl(GOOD_URL.replace('store123', 'anystore'))).toBe(true);
      expect(isTrustedImageUrl('https://evil.example.com/profile-images/a.png')).toBe(false);
    });
  });

  describe('deleteImage', () => {
    it('is a no-op for a falsy url', async () => {
      await deleteImage(null);
      await deleteImage(undefined);

      expect(del).not.toHaveBeenCalled();
    });

    it('deletes with the server token', async () => {
      await deleteImage(GOOD_URL);

      expect(del).toHaveBeenCalledWith(GOOD_URL, { token: TOKEN });
    });

    it('never throws; logs a warning when the delete fails', async () => {
      del.mockRejectedValue(new Error('blob down'));

      await expect(deleteImage(GOOD_URL)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
