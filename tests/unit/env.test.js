const env = require('../../src/config/env');

describe('env validation schema', () => {
  const baseValidEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
    JWT_ACCESS_SECRET: 'super-secret-must-be-at-least-32-characters-long',
    CORS_ORIGINS: 'https://app.example.com',
  };

  describe('CORS_ORIGINS', () => {
    const smtp = {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: 'admin@example.com',
      SMTP_PASS: 'secretpassword',
      SMTP_FROM: 'admin@example.com',
    };
    const parse = (overrides) => env.schema.safeParse({ ...baseValidEnv, ...smtp, ...overrides });
    const failedPaths = (parsed) => parsed.error.issues.map((i) => i.path[0]);

    it.each([['*'], [''], ['  '], [',']])('rejects %p in production', (value) => {
      const parsed = parse({ NODE_ENV: 'production', CORS_ORIGINS: value });
      expect(parsed.success).toBe(false);
      expect(failedPaths(parsed)).toContain('CORS_ORIGINS');
    });

    it('rejects an unset CORS_ORIGINS in production (default is the wildcard)', () => {
      const withoutCors = { ...baseValidEnv };
      delete withoutCors.CORS_ORIGINS;
      const parsed = env.schema.safeParse({ ...withoutCors, ...smtp, NODE_ENV: 'production' });
      expect(parsed.success).toBe(false);
      expect(failedPaths(parsed)).toContain('CORS_ORIGINS');
    });

    it.each(['development', 'test'])('allows the wildcard in %s', (nodeEnv) => {
      expect(parse({ NODE_ENV: nodeEnv, CORS_ORIGINS: '*' }).success).toBe(true);
    });

    it.each([
      ['https://app.example.com/'],
      ['https://app.example.com/path'],
      ['app.example.com'],
      ['ftp://app.example.com'],
      ['https://app.example.com,https://bad.example.com/'],
    ])('rejects malformed origin list %p', (value) => {
      const parsed = parse({ NODE_ENV: 'production', CORS_ORIGINS: value });
      expect(parsed.success).toBe(false);
      expect(failedPaths(parsed)).toContain('CORS_ORIGINS');
    });

    it('accepts an explicit list with ports and http localhost in production', () => {
      const parsed = parse({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com, http://localhost:3000',
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('test environment', () => {
    it('allows missing SMTP environment variables when NODE_ENV is test', () => {
      const parsed = env.schema.safeParse({
        ...baseValidEnv,
        NODE_ENV: 'test',
      });

      expect(parsed.success).toBe(true);
      expect(parsed.data.NODE_ENV).toBe('test');
      expect(parsed.data.SMTP_HOST).toBeUndefined();
      expect(parsed.data.SMTP_PORT).toBeUndefined();
      expect(parsed.data.SMTP_USER).toBeUndefined();
      expect(parsed.data.SMTP_PASS).toBeUndefined();
      expect(parsed.data.SMTP_FROM).toBeUndefined();
      expect(parsed.data.SMTP_SECURE).toBe(false);
    });

    it('accepts SMTP variables when provided in test mode', () => {
      const parsed = env.schema.safeParse({
        ...baseValidEnv,
        NODE_ENV: 'test',
        SMTP_HOST: 'smtp.mailtrap.io',
        SMTP_PORT: '2525',
        SMTP_SECURE: 'true',
        SMTP_USER: 'testuser',
        SMTP_PASS: 'testpass',
        SMTP_FROM: 'noreply@test.invalid',
      });

      expect(parsed.success).toBe(true);
      expect(parsed.data.SMTP_HOST).toBe('smtp.mailtrap.io');
      expect(parsed.data.SMTP_PORT).toBe(2525);
      expect(parsed.data.SMTP_SECURE).toBe(true);
      expect(parsed.data.SMTP_USER).toBe('testuser');
      expect(parsed.data.SMTP_PASS).toBe('testpass');
      expect(parsed.data.SMTP_FROM).toBe('noreply@test.invalid');
    });
  });

  describe('non-test environments (development / production)', () => {
    it.each(['development', 'production'])(
      'fails validation when SMTP variables are missing in %s',
      (nodeEnv) => {
        const parsed = env.schema.safeParse({
          ...baseValidEnv,
          NODE_ENV: nodeEnv,
        });

        expect(parsed.success).toBe(false);
        const issues = parsed.error.issues;
        const failedPaths = issues.map((i) => i.path[0]);

        expect(failedPaths).toContain('SMTP_HOST');
        expect(failedPaths).toContain('SMTP_PORT');
        expect(failedPaths).toContain('SMTP_USER');
        expect(failedPaths).toContain('SMTP_PASS');
        expect(failedPaths).toContain('SMTP_FROM');
      },
    );

    it.each(['development', 'production'])(
      'succeeds validation when all required SMTP variables are provided in %s',
      (nodeEnv) => {
        const parsed = env.schema.safeParse({
          ...baseValidEnv,
          NODE_ENV: nodeEnv,
          SMTP_HOST: 'smtp.gmail.com',
          SMTP_PORT: '587',
          SMTP_SECURE: 'false',
          SMTP_USER: 'admin@example.com',
          SMTP_PASS: 'secretpassword',
          SMTP_FROM: 'admin@example.com',
        });

        expect(parsed.success).toBe(true);
        expect(parsed.data.NODE_ENV).toBe(nodeEnv);
        expect(parsed.data.SMTP_HOST).toBe('smtp.gmail.com');
        expect(parsed.data.SMTP_PORT).toBe(587);
        expect(parsed.data.SMTP_SECURE).toBe(false);
      },
    );

    it('correctly transforms SMTP_SECURE to boolean true/false', () => {
      const parsedTrue = env.schema.safeParse({
        ...baseValidEnv,
        NODE_ENV: 'test',
        SMTP_SECURE: 'true',
      });
      expect(parsedTrue.data.SMTP_SECURE).toBe(true);

      const parsedFalse = env.schema.safeParse({
        ...baseValidEnv,
        NODE_ENV: 'test',
        SMTP_SECURE: 'false',
      });
      expect(parsedFalse.data.SMTP_SECURE).toBe(false);
    });
  });
});
