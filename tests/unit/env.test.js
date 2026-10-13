const fs = require('fs');
const path = require('path');
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

  describe('JWT_ACCESS_EXPIRES_IN', () => {
    const parse = (value) =>
      env.schema.safeParse({ ...baseValidEnv, NODE_ENV: 'test', JWT_ACCESS_EXPIRES_IN: value });

    it('defaults to 15m', () => {
      expect(parse(undefined).data.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    });

    it.each(['15m', '1h', '7d', '30s', '1d', '90m', '10m'])('accepts %p', (value) => {
      const parsed = parse(value);

      expect(parsed.success).toBe(true);
      expect(parsed.data.JWT_ACCESS_EXPIRES_IN).toBe(value);
    });

    it.each([
      ['abc'],
      ['900'], // jsonwebtoken would read this as 900 milliseconds
      ['0m'],
      ['0'],
      [''],
      ['m'],
      ['-5m'],
      ['1.5h'],
      ['15 m'],
      [' 15m'],
      ['15M'],
      ['15y'],
      ['2w'],
      ['007m'],
    ])('rejects %p', (value) => {
      const parsed = parse(value);

      expect(parsed.success).toBe(false);
      expect(parsed.error.issues.map((i) => i.path[0])).toContain('JWT_ACCESS_EXPIRES_IN');
    });

    it('fails at startup with a message that names the variable and the format', () => {
      const saved = { ...process.env };
      process.env.NODE_ENV = 'test';
      process.env.JWT_ACCESS_EXPIRES_IN = '900';
      const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => {
          jest.isolateModules(() => {
            require('../../src/config/env');
          });
        }).toThrow('process.exit called');

        expect(exit).toHaveBeenCalledWith(1);
        const printed = consoleError.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(printed).toContain('Invalid environment variables');
        expect(printed).toContain('JWT_ACCESS_EXPIRES_IN');
        expect(printed).toMatch(/s, m, h or d/);
        expect(printed).not.toContain(saved.JWT_ACCESS_SECRET);
      } finally {
        exit.mockRestore();
        consoleError.mockRestore();
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    });
  });

  describe('JWT_ACCESS_SECRET', () => {
    const parse = (value) =>
      env.schema.safeParse({ ...baseValidEnv, NODE_ENV: 'test', JWT_ACCESS_SECRET: value });
    const failedPaths = (parsed) => parsed.error.issues.map((i) => i.path[0]);

    it('accepts a random 96-character hex secret', () => {
      expect(
        parse('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'.repeat(2)).success,
      ).toBe(true);
    });

    it('accepts exactly 32 characters', () => {
      expect(parse('a1b2c3d4e5f60718293a4b5c6d7e8f90').success).toBe(true);
    });

    it('rejects 31 characters', () => {
      const parsed = parse('a1b2c3d4e5f60718293a4b5c6d7e8f9');

      expect(parsed.success).toBe(false);
      expect(failedPaths(parsed)).toContain('JWT_ACCESS_SECRET');
    });

    it('rejects a missing secret', () => {
      const withoutSecret = { ...baseValidEnv, NODE_ENV: 'test' };
      delete withoutSecret.JWT_ACCESS_SECRET;

      expect(env.schema.safeParse(withoutSecret).success).toBe(false);
    });

    it('rejects the placeholder shipped in .env.example, which is long enough to pass the length rule', () => {
      const example = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');
      const line = example.split(/\r?\n/).find((l) => l.startsWith('JWT_ACCESS_SECRET='));
      const placeholder = line.slice('JWT_ACCESS_SECRET='.length);

      expect(placeholder.length).toBeGreaterThanOrEqual(32);
      const parsed = parse(placeholder);
      expect(parsed.success).toBe(false);
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toMatch(/placeholder/);
    });

    it('does not repeat the old template sentence either', () => {
      const old =
        "Random secret of at least 32 characters (e.g. node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\")";

      expect(parse(old).success).toBe(false);
    });

    it.each([
      ['CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME'],
      ['change-me-change-me-change-me-change-me'],
      ['changeme-changeme-changeme-changeme-xx'],
      ['your_secret_your_secret_your_secret_xx'],
      ['your-secret-key-your-secret-key-12345'],
      ['YOUR_JWT_SECRET_YOUR_JWT_SECRET_12345'],
      ['replace_me_replace_me_replace_me_12345'],
      ['put-your-secret-here-put-your-secret-12'],
      ['this-is-a-placeholder-secret-value-1234'],
    ])('rejects the obvious placeholder %p', (value) => {
      const parsed = parse(value);

      expect(parsed.success).toBe(false);
      expect(failedPaths(parsed)).toContain('JWT_ACCESS_SECRET');
    });

    it('still accepts a normal secret that merely contains the word secret', () => {
      expect(parse('super-secret-must-be-at-least-32-characters-long').success).toBe(true);
    });
  });

  describe('refresh session hardening variables', () => {
    const testEnv = { ...baseValidEnv, NODE_ENV: 'test' };
    const parse = (overrides) => env.schema.safeParse({ ...testEnv, ...overrides });

    it('uses the defaults: 7 days grace, 15 minute window, no explicit max', () => {
      const { data } = parse({});

      expect(data.REFRESH_SESSION_CLEANUP_GRACE_DAYS).toBe(7);
      expect(data.REFRESH_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
      expect(data.REFRESH_RATE_LIMIT_MAX).toBeUndefined();
    });

    it('coerces valid string values', () => {
      const { data } = parse({
        REFRESH_SESSION_CLEANUP_GRACE_DAYS: '14',
        REFRESH_RATE_LIMIT_WINDOW_MS: '60000',
        REFRESH_RATE_LIMIT_MAX: '30',
      });

      expect(data.REFRESH_SESSION_CLEANUP_GRACE_DAYS).toBe(14);
      expect(data.REFRESH_RATE_LIMIT_WINDOW_MS).toBe(60000);
      expect(data.REFRESH_RATE_LIMIT_MAX).toBe(30);
    });

    it.each([
      ['REFRESH_SESSION_CLEANUP_GRACE_DAYS', '0'],
      ['REFRESH_SESSION_CLEANUP_GRACE_DAYS', '-1'],
      ['REFRESH_SESSION_CLEANUP_GRACE_DAYS', '1.5'],
      ['REFRESH_SESSION_CLEANUP_GRACE_DAYS', 'abc'],
      ['REFRESH_RATE_LIMIT_WINDOW_MS', '0'],
      ['REFRESH_RATE_LIMIT_MAX', '0'],
      ['REFRESH_RATE_LIMIT_MAX', '-5'],
      ['REFRESH_RATE_LIMIT_MAX', 'many'],
    ])('rejects %s=%s', (name, value) => {
      const parsed = parse({ [name]: value });

      expect(parsed.success).toBe(false);
      expect(parsed.error.issues.map((i) => i.path[0])).toContain(name);
    });
  });

  describe('refreshRateLimitMax (derived value)', () => {
    const SMTP = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_FROM: 'from@example.com',
    };

    // Loads a fresh copy of env.js with the given variables, then restores process.env.
    const loadEnv = (vars) => {
      const saved = { ...process.env };
      delete process.env.REFRESH_RATE_LIMIT_MAX;
      Object.assign(process.env, vars);
      try {
        let loaded;
        jest.isolateModules(() => {
          loaded = require('../../src/config/env');
        });
        return loaded;
      } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    };

    it('is 60 outside the test environment', () => {
      expect(loadEnv({ NODE_ENV: 'development', ...SMTP }).refreshRateLimitMax).toBe(60);
    });

    it('is raised in the test environment so suites are not rate limited', () => {
      expect(loadEnv({ NODE_ENV: 'test' }).refreshRateLimitMax).toBeGreaterThan(1000);
    });

    it('uses REFRESH_RATE_LIMIT_MAX when it is set, in any environment', () => {
      expect(loadEnv({ NODE_ENV: 'test', REFRESH_RATE_LIMIT_MAX: '5' }).refreshRateLimitMax).toBe(
        5,
      );
      expect(
        loadEnv({ NODE_ENV: 'development', ...SMTP, REFRESH_RATE_LIMIT_MAX: '9' })
          .refreshRateLimitMax,
      ).toBe(9);
    });
  });
});
