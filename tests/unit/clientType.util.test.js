const { ClientType, detectClientType } = require('../../src/utils/clientType.util');

const ALLOWED = ['https://app.example.com', 'http://localhost:3000'];
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const detect = (input) => detectClientType({ allowedOrigins: ALLOWED, ...input });

describe('detectClientType', () => {
  describe('mobile (Kotlin / OkHttp)', () => {
    it.each([
      'okhttp/4.12.0',
      'OkHttp/5.0.0-alpha.14',
      'MySpiritApp/1.2 okhttp/4.12.0',
      'retrofit/2.9.0',
      'Ktor client',
      'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/UQ1A)',
      'Apache-HttpClient/UNAVAILABLE (java 1.5)',
    ])('classifies %p without Origin as mobile', (userAgent) => {
      expect(detect({ userAgent })).toBe(ClientType.MOBILE);
    });
  });

  describe('web (Next.js / browsers)', () => {
    it('classifies an allowed Origin as web regardless of user agent', () => {
      expect(detect({ userAgent: CHROME, origin: 'https://app.example.com' })).toBe(ClientType.WEB);
      expect(detect({ userAgent: undefined, origin: 'http://localhost:3000' })).toBe(
        ClientType.WEB,
      );
    });

    it('matches the Origin case-insensitively and ignoring surrounding spaces', () => {
      expect(detect({ userAgent: CHROME, origin: ' HTTPS://APP.EXAMPLE.COM ' })).toBe(
        ClientType.WEB,
      );
    });

    it.each([CHROME, SAFARI_IOS, CHROME_ANDROID])(
      'classifies a browser user agent without Origin (same-origin) as web',
      (userAgent) => {
        expect(detect({ userAgent })).toBe(ClientType.WEB);
      },
    );

    it('treats any Origin as web when CORS allows the wildcard', () => {
      expect(
        detectClientType({
          userAgent: CHROME,
          origin: 'http://anything.test',
          allowedOrigins: '*',
        }),
      ).toBe(ClientType.WEB);
    });
  });

  describe('unknown', () => {
    it('classifies an Origin that is not allowed as unknown', () => {
      expect(detect({ userAgent: CHROME, origin: 'https://evil.example.com' })).toBe(
        ClientType.UNKNOWN,
      );
    });

    it('does not let an OkHttp user agent plus a foreign Origin become mobile or web', () => {
      expect(detect({ userAgent: 'okhttp/4.12.0', origin: 'https://evil.example.com' })).toBe(
        ClientType.UNKNOWN,
      );
    });

    it.each([
      ['curl/8.5.0'],
      ['PostmanRuntime/7.39.0'],
      ['node'],
      ['Mozilla/5.0 node-fetch'],
      [''],
      ['   '],
      [undefined],
      [null],
      [123],
    ])('classifies user agent %p without Origin as unknown', (userAgent) => {
      expect(detect({ userAgent })).toBe(ClientType.UNKNOWN);
    });

    it('does not match substrings inside other words', () => {
      expect(detect({ userAgent: 'notokhttpish/1.0' })).toBe(ClientType.UNKNOWN);
    });

    it('returns unknown with no arguments at all', () => {
      expect(detectClientType()).toBe(ClientType.UNKNOWN);
      expect(detectClientType({})).toBe(ClientType.UNKNOWN);
    });

    it('treats a non-string or empty Origin as absent', () => {
      expect(detect({ userAgent: 'okhttp/4.12.0', origin: '' })).toBe(ClientType.MOBILE);
      expect(detect({ userAgent: 'okhttp/4.12.0', origin: 42 })).toBe(ClientType.MOBILE);
    });
  });
});
