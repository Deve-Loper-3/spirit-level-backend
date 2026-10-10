require('dotenv').config();
const { z } = require('zod');

// Browsers send the Origin header as scheme://host[:port] (lowercase host, no path).
const BARE_ORIGIN_REGEX = /^https?:\/\/[^\s/?#]+$/;

const splitOrigins = (value) =>
  value
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().default('*'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(12),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        const num = Number(val);
        if (!Number.isNaN(num)) return num;
        return val;
      }),
    SMTP_HOST: z.string().min(1, 'SMTP_HOST is required').optional(),
    SMTP_PORT: z.coerce.number().int().positive('SMTP_PORT must be a positive integer').optional(),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    SMTP_USER: z.string().min(1, 'SMTP_USER is required').optional(),
    SMTP_PASS: z.string().min(1, 'SMTP_PASS is required').optional(),
    SMTP_FROM: z.string().min(1, 'SMTP_FROM is required').optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.CORS_ORIGINS.trim() !== '*') {
      const invalid = splitOrigins(data.CORS_ORIGINS).filter(
        (origin) => !BARE_ORIGIN_REGEX.test(origin),
      );
      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message:
            'CORS_ORIGINS entries must be bare origins like https://app.example.com (no path, query or trailing slash)',
        });
      }
    }

    if (data.NODE_ENV === 'production') {
      const origins = splitOrigins(data.CORS_ORIGINS);
      if (data.CORS_ORIGINS.trim() === '*' || origins.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message:
            'CORS_ORIGINS must be an explicit comma-separated list of origins in production (wildcard "*" is not allowed)',
        });
      }
    }

    if (data.NODE_ENV !== 'test') {
      const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
      for (const field of required) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required`,
          });
        }
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Logger env par depend karta hai, isliye yahan console.error allowed hai.
  // eslint-disable-next-line no-console
  console.error(`Invalid environment variables:\n${issues}`);
  process.exit(1);
}

const data = parsed.data;

const env = Object.freeze({
  ...data,
  schema,
  isDev: data.NODE_ENV === 'development',
  isProd: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  corsOrigins: data.CORS_ORIGINS.trim() === '*' ? '*' : splitOrigins(data.CORS_ORIGINS),
  trustProxy: data.TRUST_PROXY,
});

module.exports = env;
