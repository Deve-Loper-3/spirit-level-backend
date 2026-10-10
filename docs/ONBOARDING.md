# Developer Onboarding Guide — Backend

Welcome to the backend development team for **Spirit Level**. This document is a comprehensive technical onboarding guide created by inspecting the actual codebase on disk.

Every component, file, and architectural pattern documented here is explicitly categorized by its implementation state:
- `[IMPLEMENTED]`: The file exists on disk and contains functional production code.
- `[PLACEHOLDER]`: The file or folder exists on disk but is currently empty (0 bytes) or contains only a `.gitkeep`.
- `[PLANNED]`: Identified from comments, documentation, or the predecessor TypeScript branch specifications, awaiting implementation.

---

## 1. Overview

### 1.1 Project Identity
- **Project Name**: `spirit-level-backend` (declared in `package.json`)
- **Repository**: `https://github.com/spirit-level-App/Backend.git`
- **Application Context**: Backend REST API service for the Spirit Level application ecosystem.

### 1.2 Branch Context: JavaScript Conversion
The current active branch is `javascriptconversiondaniyalkhan`.
- **Historical Context**: The backend was originally prototyped in TypeScript (`gym-management-auth` on branches `authorization`, `main`, and `dev`) using TypeScript 5.4.5, `ts-node-dev`, and strict type definitions.
- **Conversion Objective**: The codebase is undergoing a full rewrite to modern, idiomatic Node.js JavaScript (ES2022). The goal is to eliminate compilation overhead, reduce runtime complexity, and standardize on a clean functional Controller-Service-Repository architecture with Zod runtime validation and native Prisma integration.

### 1.3 Runtime Environment & Module System
- **Node.js Engine**: `>= 20.0.0` (enforced via `package.json` `engines` field). Active host runtime: `v22.23.2`.
- **Package Manager**: `npm` (`10.9.8`).
- **Module System**: **CommonJS** (`require` / `module.exports`).
  - `"type": "module"` is omitted from `package.json`.
  - `eslint.config.js` explicitly defines `sourceType: 'commonjs'` and `ecmaVersion: 2022`.
- **Runtime Stack**:
  - Web Server: **Express 5** (`express@^5.2.1`)
  - Database ORM: **Prisma 6** (`@prisma/client@^6.19.3`) targeting **PostgreSQL**
  - Logging: **Pino** (`pino@^10.3.1`) with **pino-http** (`pino-http@^11.0.0`)
  - Security: **Helmet** (`helmet@^8.3.0`) & **CORS** (`cors@^2.8.6`)
  - Validation: **Zod** (`zod@^4.6.5`)
  - Environment Management: **dotenv** (`dotenv@^18.0.4`)

---

## 2. Tech Stack Table

Below is the complete inventory of all production and development dependencies declared in `package.json`:

### Production Dependencies (`dependencies`)

| Package | Version | Purpose | Implementation Status |
| :--- | :--- | :--- | :--- |
| `@prisma/client` | `^6.19.3` | Next-generation Node.js ORM client for PostgreSQL query generation and execution. | `[IMPLEMENTED]` |
| `cors` | `^2.8.6` | Express middleware providing Cross-Origin Resource Sharing configuration. | `[IMPLEMENTED]` |
| `dotenv` | `^18.0.4` | Loads environment variables from `.env` into `process.env`. | `[IMPLEMENTED]` |
| `express` | `^5.2.1` | Web routing framework providing HTTP pipeline, request handling, and middleware support. | `[IMPLEMENTED]` |
| `helmet` | `^8.3.0` | Security middleware configuring protective HTTP response headers (CSP, HSTS, XSS, etc.). | `[IMPLEMENTED]` |
| `pino` | `^10.3.1` | Ultra-fast, low-overhead structured JSON application logger. | `[IMPLEMENTED]` |
| `pino-http` | `^11.0.0` | High-performance HTTP request/response logging middleware for Express. | `[IMPLEMENTED]` |
| `zod` | `^4.6.5` | TypeScript-first schema declaration and runtime validation library. | `[IMPLEMENTED]` |

### Development Dependencies (`devDependencies`)

| Package | Version | Purpose | Implementation Status |
| :--- | :--- | :--- | :--- |
| `@eslint/js` | `^10.0.1` | ESLint recommended JavaScript configuration ruleset. | `[IMPLEMENTED]` |
| `eslint` | `^10.11.0` | Pluggable linting utility for static code analysis and enforcing code style. | `[IMPLEMENTED]` |
| `eslint-config-prettier` | `^10.1.8` | Disables ESLint formatting rules that conflict with Prettier. | `[IMPLEMENTED]` |
| `globals` | `^17.12.0` | Provides Node.js and Jest global variable definitions for ESLint flat config. | `[IMPLEMENTED]` |
| `jest` | `^30.5.2` | Test runner and assertion framework for unit and integration testing. | `[IMPLEMENTED]` |
| `nodemon` | `^3.1.14` | Development file monitor for automatically restarting the server on file changes. | `[IMPLEMENTED]` |
| `pino-pretty` | `^13.1.3` | Formats Pino structured JSON logs into readable, colorized terminal output for local development. | `[IMPLEMENTED]` |
| `prettier` | `^3.9.9` | Opinionated code formatter enforcing consistent syntax and spacing. | `[IMPLEMENTED]` |
| `prisma` | `^6.19.3` | Prisma CLI toolkit for database migrations, introspections, and client generation. | `[IMPLEMENTED]` |
| `supertest` | `^7.3.0` | HTTP assertion library for testing Express routing endpoints without network binding. | `[IMPLEMENTED]` |

---

## 3. Folder Structure

Below is the directory tree of the Backend repository (excluding `node_modules`, `.git`, and `.kilo`), followed by a one-line description for every file and folder.

```text
Backend/
├── .editorconfig
├── .env
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc
├── eslint.config.js
├── jest.config.js
├── package.json
├── package-lock.json
├── README.md
├── docs/
│   └── ONBOARDING.md
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.js
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   ├── container.js
│   │   ├── env.js
│   │   ├── logger.js
│   │   └── prisma.js
│   ├── constants/
│   │   ├── messages.js
│   │   ├── roles.js
│   │   └── status.js
│   ├── docs/
│   │   └── .gitkeep
│   ├── errors/
│   │   └── AppError.js
│   ├── infra/
│   │   ├── cache/
│   │   │   └── .gitkeep
│   │   ├── mail/
│   │   │   └── notify.service.js
│   │   └── queue/
│   │       ├── consumers/
│   │       │   └── .gitkeep
│   │       └── producers/
│   │           └── .gitkeep
│   ├── middlewares/
│   │   ├── authenticate.middleware.js
│   │   ├── authorize.middleware.js
│   │   ├── errorHandler.middleware.js
│   │   ├── notFound.middleware.js
│   │   ├── rateLimiter.middleware.js
│   │   └── validate.middleware.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── staff.controller.js
│   │   └── uploads.controller.js
│   ├── services/
│   │   ├── auth.guards.js
│   │   ├── auth.service.js
│   │   ├── login.policies.js
│   │   ├── staff.policies.js
│   │   └── staff.service.js
│   ├── repositories/
│   │   ├── audit-log.repository.js
│   │   ├── otp.repository.js
│   │   ├── password-reset.repository.js
│   │   ├── session.repository.js
│   │   ├── staff.mapper.js
│   │   ├── staff.repository.js
│   │   ├── user.mapper.js
│   │   └── user.repository.js
│   ├── validators/
│   │   ├── auth.validation.js
│   │   ├── staff.validation.js
│   │   └── uploads.validation.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── health.routes.js
│   │   ├── index.js
│   │   ├── staff.routes.js
│   │   ├── uploads.routes.js
│   │   └── v1.js
│   └── utils/
│       ├── apiResponse.util.js
│       ├── asyncHandler.util.js
│       ├── duration.util.js
│       ├── jwt.util.js
│       ├── otp.util.js
│       └── password.util.js
└── tests/
    ├── helpers/
    │   └── .gitkeep
    ├── integration/
    │   ├── admin.staff.test.js
    │   ├── auth.forgot-password.test.js
    │   ├── auth.login.test.js
    │   ├── auth.me.test.js
    │   └── auth.register.test.js
    └── unit/
        └── .gitkeep
```

### Complete File & Folder Inventory

| Path | Status | Purpose |
| :--- | :--- | :--- |
| `.editorconfig` | `[IMPLEMENTED]` | Editor configuration defining 2-space indentation, UTF-8 charset, LF line endings, and whitespace trimming. |
| `.env` | `[IMPLEMENTED]` | Local environment configuration file (git-ignored, contains active credentials). |
| `.env.example` | `[IMPLEMENTED]` | Safe template showing required environment variables and defaults without secrets. |
| `.gitignore` | `[IMPLEMENTED]` | Git rules ignoring `node_modules`, `.env`, build artifacts, test coverage, logs, and editor caches. |
| `.prettierignore` | `[IMPLEMENTED]` | Ignores `node_modules`, `coverage`, `dist`, `prisma/migrations`, and lockfiles during Prettier formatting. |
| `.prettierrc` | `[IMPLEMENTED]` | Prettier styling rules: single quotes, semicolons, trailing commas, 100 print width, 2 spaces. |
| `eslint.config.js` | `[IMPLEMENTED]` | ESLint 9+ flat config specifying Node/Jest environments, strict rules, and Prettier integration. |
| `jest.config.js` | `[IMPLEMENTED]` | Jest configuration defining `node` test environment, `<rootDir>/tests` root, and automatic mock clearing. |
| `package.json` | `[IMPLEMENTED]` | Project manifest defining name, scripts, dependencies, devDependencies, and Node.js engine `>=20`. |
| `package-lock.json` | `[IMPLEMENTED]` | Deterministic dependency tree lockfile. |
| `README.md` | `[IMPLEMENTED]` | Minimal project header document (`# Backend`). |
| `docs/` | `[IMPLEMENTED]` | Central documentation directory for developer guides and onboarding specs. |
| `docs/ONBOARDING.md` | `[IMPLEMENTED]` | Comprehensive onboarding manual for developers joining the backend project. |
| `prisma/` | `[IMPLEMENTED]` | Database ORM schema, migrations, and seed scripts. |
| `prisma/migrations/` | `[PLACEHOLDER]` | Directory designated for Prisma SQL migration files (currently empty). |
| `prisma/schema.prisma` | `[IMPLEMENTED]` | Prisma schema defining client generator (`prisma-client-js`) and datasource (`postgresql`). |
| `prisma/seed.js` | `[PLACEHOLDER]` | Database seed script file (currently empty). |
| `src/` | `[IMPLEMENTED]` | Application source code root directory. |
| `src/app.js` | `[IMPLEMENTED]` | Express app factory (`createApp`) configuring security, logging, body parsing, routes, and error handling. |
| `src/server.js` | `[IMPLEMENTED]` | Application process entry point managing DB connection, HTTP listener boot, and graceful shutdown. |
| `src/config/` | `[IMPLEMENTED]` | Configuration singletons and environment wrappers. |
| `src/config/container.js` | `[PLACEHOLDER]` | Empty file reserved for dependency injection / service container initialization. |
| `src/config/env.js` | `[IMPLEMENTED]` | Zod schema validation for environment variables with fail-fast boot and frozen export. |
| `src/config/logger.js` | `[IMPLEMENTED]` | Pino logger singleton with sensitive header redaction, log levels, and dev pretty-printing. |
| `src/config/prisma.js` | `[IMPLEMENTED]` | Prisma Client singleton configured with environment-based log levels. |
| `src/constants/` | `[IMPLEMENTED]` | Domain constants and static value mappings. |
| `src/constants/messages.js` | `[PLACEHOLDER]` | Empty placeholder for shared API error, success, and validation message strings. |
| `src/constants/roles.js` | `[PLACEHOLDER]` | Empty placeholder for application user role definitions (`MEMBER`, `COACH`, `ADMIN`, `OWNER`). |
| `src/constants/status.js` | `[PLACEHOLDER]` | Empty placeholder for account and resource status constants (`ACTIVE`, `PENDING`, `DISABLED`). |
| `src/docs/` | `[PLACEHOLDER]` | Directory reserved for internal API specifications or OpenAPI documents. |
| `src/docs/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for `src/docs/`. |
| `src/errors/` | `[IMPLEMENTED]` | Custom error definitions and factories. |
| `src/errors/AppError.js` | `[IMPLEMENTED]` | `createAppError` factory creating operational errors with HTTP status codes, codes, and details. |
| `src/infra/` | `[IMPLEMENTED]` | External service adapters and third-party infrastructure integrations. |
| `src/infra/cache/` | `[PLACEHOLDER]` | Directory reserved for Redis caching clients and caching helpers. |
| `src/infra/cache/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for `src/infra/cache/`. |
| `src/infra/mail/` | `[IMPLEMENTED]` | Directory for email, SMS, and transactional notification services. |
| `src/infra/mail/notify.service.js` | `[PLACEHOLDER]` | Empty placeholder for transactional email/SMS dispatch service. |
| `src/infra/queue/` | `[IMPLEMENTED]` | Directory reserved for message queue brokers (RabbitMQ/BullMQ). |
| `src/infra/queue/consumers/` | `[PLACEHOLDER]` | Directory reserved for queue worker consumers. |
| `src/infra/queue/consumers/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for queue consumers. |
| `src/infra/queue/producers/` | `[PLACEHOLDER]` | Directory reserved for queue publishers and message producers. |
| `src/infra/queue/producers/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for queue producers. |
| `src/middlewares/` | `[IMPLEMENTED]` | Express HTTP middleware functions. |
| `src/middlewares/authenticate.middleware.js` | `[PLACEHOLDER]` | Empty placeholder for JWT Bearer token authentication and request user decoration. |
| `src/middlewares/authorize.middleware.js` | `[PLACEHOLDER]` | Empty placeholder for Role-Based Access Control (RBAC) permission enforcement. |
| `src/middlewares/errorHandler.middleware.js` | `[IMPLEMENTED]` | Global Express 4-argument error handler formatting operational and unexpected error responses. |
| `src/middlewares/notFound.middleware.js` | `[IMPLEMENTED]` | 404 catch-all middleware returning `ROUTE_NOT_FOUND` `AppError`. |
| `src/middlewares/rateLimiter.middleware.js` | `[IMPLEMENTED]` | Rate limiting middleware using express-rate-limit. |
| `src/middlewares/validate.middleware.js` | `[PLACEHOLDER]` | Empty placeholder for Zod request body/query/params validation middleware. |
| `src/controllers/` | `[IMPLEMENTED]` | HTTP handlers (`auth`, `staff`, `uploads`); thin, delegate to services. |
| `src/services/` | `[IMPLEMENTED]` | Business logic plus guards/policies (`auth.service`, `staff.service`, `auth.guards`, `login.policies`, `staff.policies`). |
| `src/repositories/` | `[IMPLEMENTED]` | Prisma data access (`*.repository.js`) and data mappers (`*.mapper.js`). |
| `src/validators/` | `[IMPLEMENTED]` | Zod request schemas (`*.validation.js`). |
| `src/routes/` | `[IMPLEMENTED]` | Top-level API route definitions and router trees. |
| `src/routes/health.routes.js` | `[IMPLEMENTED]` | Health router implementing `GET /health` (liveness) and `GET /health/ready` (readiness with DB query). |
| `src/routes/index.js` | `[IMPLEMENTED]` | Master router mounting `/health` and `/api/v1`. |
| `src/routes/v1.js` | `[IMPLEMENTED]` | API v1 router mounting domain feature routes (currently contains commented mount example). |
| `src/utils/` | `[IMPLEMENTED]` | Shared utility functions and domain helpers. |
| `src/utils/apiResponse.util.js` | `[PLACEHOLDER]` | Empty placeholder for standardized JSON response payload formatting. |
| `src/utils/asyncHandler.util.js` | `[PLACEHOLDER]` | Empty placeholder for async route handler try/catch wrapper. |
| `src/utils/duration.util.js` | `[PLACEHOLDER]` | Empty placeholder for time and duration string parsing. |
| `src/utils/jwt.util.js` | `[PLACEHOLDER]` | Empty placeholder for JWT signing, verification, and decoding. |
| `src/utils/otp.util.js` | `[PLACEHOLDER]` | Empty placeholder for 6-digit numeric OTP generation and hashing. |
| `src/utils/password.util.js` | `[PLACEHOLDER]` | Empty placeholder for bcrypt password hashing and comparison. |
| `tests/` | `[IMPLEMENTED]` | Automated test suites and testing fixtures. |
| `tests/helpers/` | `[PLACEHOLDER]` | Test helper utilities and database fixtures directory. |
| `tests/helpers/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for `tests/helpers/`. |
| `tests/integration/` | `[IMPLEMENTED]` | Integration test suites verifying HTTP endpoints. |
| `tests/integration/admin.staff.test.js` | `[PLACEHOLDER]` | Empty placeholder test suite for staff administration endpoints. |
| `tests/integration/auth.forgot-password.test.js` | `[PLACEHOLDER]` | Empty placeholder test suite for OTP password reset flow. |
| `tests/integration/auth.login.test.js` | `[PLACEHOLDER]` | Empty placeholder test suite for user login. |
| `tests/integration/auth.me.test.js` | `[PLACEHOLDER]` | Empty placeholder test suite for authenticated profile fetching. |
| `tests/integration/auth.register.test.js` | `[PLACEHOLDER]` | Empty placeholder test suite for user registration. |
| `tests/unit/` | `[PLACEHOLDER]` | Unit tests directory. |
| `tests/unit/.gitkeep` | `[PLACEHOLDER]` | Git tracking placeholder for `tests/unit/`. |

---

## 4. Request Lifecycle

The application follows a structured, layered request-response lifecycle. Every HTTP request enters through Express, passes through a pipeline of global middlewares, traverses the routing hierarchy, and is processed by domain-specific layers.

### 4.1 End-to-End Request Flow Diagram

```text
Incoming HTTP Request
       │
       ▼
[server.js] ──> Starts HTTP server after Prisma.$connect()
       │
       ▼
   [app.js] (createApp)
       │
       ├─► 1. app.disable('x-powered-by')
       ├─► 2. helmet()
       ├─► 3. cors({ origin: env.corsOrigins })
       ├─► 4. pinoHttp({ logger, autoLogging: { ignore: /health/ } })
       ├─► 5. express.json({ limit: '1mb' })
       ├─► 6. express.urlencoded({ extended: true })
       │
       ▼
[routes/index.js]
       │
       ├──► /health ────────► [health.routes.js]
       │                          ├── GET /       ──> Liveness response (200)
       │                          └── GET /ready  ──> prisma.$queryRaw`SELECT 1` (200 / 503)
       │
       └──► /api/v1 ────────► [v1.js]
                                  │
                                  ▼
                             [Module Routes] (e.g. auth.routes.js)
                                  │ (validate.middleware, authenticate.middleware)
                                  ▼
                             [Controller] (e.g. auth.controller.js)
                                  │ Unpacks req.body / req.params
                                  ▼
                             [Service] (e.g. auth.service.js)
                                  │ Enforces business rules & hashes/verifies
                                  ▼
                             [Repository] (e.g. user.repository.js)
                                  │ Calls Prisma Client query methods
                                  ▼
                             [Prisma Client] ──> PostgreSQL Database
                                  │
       ◄──────────────────────────┘ (Result bubbles back through Repository -> Service -> Controller)
       │
       ▼
HTTP Response (e.g. res.status(200).json({ success: true, data }))

─────────────────────────────────────────────────────────────────────────────
Error Fallback Path:
Unmatched Route ──► [notFound.middleware.js] ──► next(createAppError(404))
                                                         │
                                                         ▼
Thrown Error in Handler ────────────────────────► [errorHandler.middleware.js]
                                                         │
                                                         ▼
                                          HTTP Error Response (JSON)
```

### 4.2 Exact Middleware Order in `src/app.js`

The middleware pipeline in `src/app.js` is registered in the following sequence:

1. `app.disable('x-powered-by')`
   Removes the default `X-Powered-By: Express` header to obscure server fingerprinting.
2. `app.use(helmet())`
   Injects secure HTTP response headers (Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, etc.).
3. `app.use(cors({ origin: env.corsOrigins }))`
   Evaluates incoming `Origin` headers against the allowed whitelist configured in `env.corsOrigins` (`*` or parsed array).
4. `app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/health') } }))`
   Attaches a scoped child logger to `req.log`, assigns a request ID, measures response latency, and logs completion (ignoring all `/health*` URLs).
5. `app.use(express.json({ limit: '1mb' }))`
   Parses incoming JSON request bodies up to a strict 1MB size limit.
6. `app.use(express.urlencoded({ extended: true }))`
   Parses URL-encoded payload data using the `qs` library.
7. `app.use(routes)`
   Mounts the primary routing router from `src/routes/index.js`.
8. `app.use(notFound)`
   404 catch-all middleware (`src/middlewares/notFound.middleware.js`) triggered when no route handles the request. Passes an operational `ROUTE_NOT_FOUND` error to `next()`.
9. `app.use(errorHandler)`
   Global 4-argument error-handling middleware (`src/middlewares/errorHandler.middleware.js`) catching all operational and unhandled runtime exceptions.

---

## 5. Config and Environment

All runtime configuration is managed through `src/config/env.js`, which strictly parses and validates environment variables at application startup using **Zod**.

### 5.1 Environment Schema (`src/config/env.js`)

| Variable | Type | Allowed Values / Constraint | Default Value | Required / Optional |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `enum` | `'development'`, `'test'`, `'production'` | `'development'` | Optional |
| `PORT` | `number` | Positive integer (coerced via `z.coerce.number().int().positive()`) | `5000` | Optional |
| `LOG_LEVEL` | `enum` | `'fatal'`, `'error'`, `'warn'`, `'info'`, `'debug'`, `'trace'`, `'silent'` | `'info'` | Optional |
| `CORS_ORIGINS` | `string` | Any string (wildcard `'*'` or comma-separated origins) | `'*'` | Optional |
| `DATABASE_URL` | `string` | Minimum length 1 (`z.string().min(1, 'DATABASE_URL is required')`) | *None* | **Required** |

### 5.2 Boot-Time Validation & Fail-Fast Behavior
When `src/config/env.js` is imported:
1. `require('dotenv').config()` loads the local `.env` file into `process.env`.
2. `schema.safeParse(process.env)` evaluates all variables.
3. **If validation fails (`!parsed.success`)**:
   - The validation issues are mapped into formatted bullet points:
     ```text
     Invalid environment variables:
       - DATABASE_URL: DATABASE_URL is required
     ```
   - Because the structured logger depends on valid environment variables, output is printed directly via `console.error` (with an explicit `// eslint-disable-next-line no-console` comment).
   - The process immediately terminates: `process.exit(1)`.
4. **If validation succeeds**:
   - Helper properties are computed:
     - `isDev`: `data.NODE_ENV === 'development'`
     - `isProd`: `data.NODE_ENV === 'production'`
     - `isTest`: `data.NODE_ENV === 'test'`
     - `corsOrigins`: `data.CORS_ORIGINS === '*' ? '*' : data.CORS_ORIGINS.split(',').map((origin) => origin.trim())`
   - The final object is sealed via `Object.freeze()` and exported.

### 5.3 Contents of `.env.example`
The repository includes a safe, unpopulated environment template at `Backend/.env.example`:

```env
NODE_ENV=development
PORT=5000
LOG_LEVEL=debug
CORS_ORIGINS=*
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DB_NAME?schema=public
```

---

## 6. Logging Architecture

Application logging is standardized on **Pino** (`src/config/logger.js`) and **pino-http** (`src/app.js`).

### 6.1 Logger Setup
```javascript
// src/config/logger.js
const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
  ...(env.isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});
```

### 6.2 Redaction Rules
Sensitive information is masked before serialization:
- `req.headers.authorization`: Masks JWT Bearer tokens.
- `req.headers.cookie`: Masks session identifiers.
- `password`: Masks top-level password fields in bodies/params.
- `*.password`: Recursively masks nested password fields across all payloads.

### 6.3 Development vs. Production Behavior
- **Development (`NODE_ENV=development`)**:
  - `pino-pretty` is activated.
  - Logs are formatted in colorized, human-readable text.
  - Timestamps are formatted as local `SYS:HH:MM:ss`.
  - Process ID (`pid`) and `hostname` are omitted for terminal clarity.
- **Production (`NODE_ENV=production`)**:
  - `pino-pretty` is completely omitted.
  - Raw, single-line JSON is written to standard output (`stdout`), minimizing CPU overhead and enabling straightforward ingestion by log aggregators (Datadog, AWS CloudWatch, ELK).
- **Test (`NODE_ENV=test`)**:
  - Log level is overridden to `'silent'` to maintain clean test runner output.
- **HTTP Request Suppression**:
  - `pino-http` ignores paths starting with `/health` (`autoLogging: { ignore: (req) => req.url.startsWith('/health') }`) to prevent high-frequency Kubernetes/uptime monitoring checks from flooding logs.

---

## 7. Error Handling

Error handling distinguishes between **operational errors** (expected user, input, or authorization failures) and **unexpected programmer errors** (unhandled bugs, database disconnects, syntax exceptions).

### 7.1 The `createAppError` Factory (`src/errors/AppError.js`)
Instead of an ES6 class hierarchy, operational errors are created via a lightweight factory function:

```javascript
// src/errors/AppError.js
const createAppError = (statusCode, message, code = 'APP_ERROR', details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  error.isOperational = true;
  Error.captureStackTrace(error, createAppError);
  return error;
};
```
- Attaches HTTP status code, machine-readable `code`, optional validation `details`, and sets `isOperational = true`.
- Removes the factory frame from the error stack trace via `Error.captureStackTrace`.

### 7.2 The Global Error Handler (`src/middlewares/errorHandler.middleware.js`)
All errors passed to Express `next(err)` are received by `errorHandler`:

```javascript
// src/middlewares/errorHandler.middleware.js
const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = Boolean(err.isOperational || err.expose);

  if (statusCode >= 500 || !isOperational) {
    logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled error');
  }

  res.status(statusCode).json({
    success: false,
    code: err.code || 'INTERNAL_ERROR',
    message: isOperational ? err.message : 'Internal server error',
    ...(err.details && { details: err.details }),
    ...(env.isDev && !isOperational && { stack: err.stack }),
  });
};
```

### 7.3 Operational vs. Unexpected Errors

| Property | Operational Error (`isOperational: true`) | Unexpected Error (`isOperational: false`) |
| :--- | :--- | :--- |
| **Origin** | Thrown intentionally via `createAppError(statusCode, message, code, details)`. | Unhandled exceptions, syntax errors, database connection failures. |
| **HTTP Status** | Explicit client status code (e.g., `400`, `401`, `403`, `404`, `409`, `422`). | Defaults to `500`. |
| **Server Logging** | Not logged as errors if `< 500` (prevents log noise). | Logged with full error stack via `logger.error(..., 'Unhandled error')`. |
| **Response Message** | The actual descriptive error message (e.g. `'Route not found: GET /invalid'`). | Masked to generic `'Internal server error'`. |
| **Response Code** | Domain code (e.g. `'ROUTE_NOT_FOUND'`, `'INVALID_CREDENTIALS'`). | Default `'INTERNAL_ERROR'`. |
| **Stack Trace** | Stack is never exposed in response body. | Included in response body **only in development mode** (`env.isDev`). |

---

## 8. Routes & Endpoints

### 8.1 Complete Route Inventory

| Method | Path | Handler | Auth Required | Status |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Liveness check in `src/routes/health.routes.js` | None | `[IMPLEMENTED]` |
| `GET` | `/health/ready` | Readiness check with `SELECT 1` in `src/routes/health.routes.js` | None | `[IMPLEMENTED]` |
| `ALL` | `*` (any unmatched) | Catch-all 404 handler in `src/middlewares/notFound.middleware.js` | None | `[IMPLEMENTED]` |
| `USE` | `/api/v1` | Top-level v1 router in `src/routes/v1.js` | None | `[IMPLEMENTED]` (Router exists, no sub-routes mounted) |
| `POST` | `/api/v1/auth/register` | User self-registration in `src/controllers/auth.controller.js` | None | `[PLANNED]` (Placeholder file exists) |
| `POST` | `/api/v1/auth/login` | User login & token generation in `src/controllers/auth.controller.js` | None | `[PLANNED]` (Placeholder file exists) |
| `GET` | `/api/v1/auth/me` | Fetch authenticated profile in `src/controllers/auth.controller.js` | Bearer JWT | `[PLANNED]` (Placeholder file exists) |
| `POST` | `/api/v1/auth/forgot-password` | Request password reset OTP in `src/controllers/auth.controller.js` | None | `[PLANNED]` (Placeholder file exists) |
| `ALL` | `/api/v1/staff/*` | Staff administrative routes in `src/controllers/staff.controller.js` | Bearer JWT + Admin Role | `[PLANNED]` (Placeholder file exists) |

### 8.2 Health Check Implementation Details
Mounted at `/health` via `src/routes/index.js`:
- **`GET /health`** (Liveness Probe):
  Returns process status, uptime in seconds, and ISO timestamp.
  ```json
  {
    "status": "ok",
    "uptime": 12.345,
    "timestamp": "2026-09-30T08:35:06.363Z"
  }
  ```
- **`GET /health/ready`** (Readiness Probe):
  Executes `await prisma.$queryRaw\`SELECT 1\``.
  - If database is healthy: HTTP `200` with `{"status": "ready", "db": "up"}`.
  - If database query fails: HTTP `503` with `{"status": "not_ready", "db": "down"}` and logs error via `req.log.error`.

### 8.3 Mounting New Modules in `src/routes/v1.js`
In `src/routes/index.js`, the `/api/v1` prefix is bound to `src/routes/v1.js`:
```javascript
// src/routes/index.js
router.use('/health', healthRoutes);
router.use('/api/v1', v1Routes);
```

To mount a new feature module (e.g. `auth` or `staff`), update `src/routes/v1.js` as documented in its source comments:
```javascript
// src/routes/v1.js
const { Router } = require('express');
const authRoutes = require('./auth.routes');
const staffRoutes = require('./staff.routes');

const router = Router();

// Mount feature routers:
router.use('/auth', authRoutes);
router.use('/staff', staffRoutes);

module.exports = router;
```

---

## 9. Database Architecture

### 9.1 Prisma Version
- Prisma CLI: `6.19.3`
- `@prisma/client`: `6.19.3`

### 9.2 Prisma Schema Contents (`prisma/schema.prisma`)
The file on disk defines the generator and datasource:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

#### Schema Status & Domain Models
- **Current Disk State**: `[IMPLEMENTED]` for generator and datasource. No models or enums are defined in `prisma/schema.prisma` yet (`[PLACEHOLDER]`).
- **Planned Domain Models**: Derived from the predecessor TypeScript backend and repository placeholders:
  - **`User`**: Core user entity (`id`, `firstName`, `lastName`, `email`, `phone`, `whatsappNumber`, `dateOfBirth`, `passwordHash`, `role`, `status`, `emailVerified`, `phoneVerified`, `createdAt`, `updatedAt`, `lastLoginAt`).
  - **`RefreshTokenSession`**: Session state tracking (`jti`, `userId`, `expiresAt`, `revoked`, `createdAt`).
  - **`PasswordResetOtp`**: Temporary OTP records (`id`, `userId`, `email`, `codeHash`, `purpose`, `status`, `expiresAt`, `verifiedAt`, `usedAt`).
  - **`AuditLog`**: System and user audit records (`id`, `action`, `userId`, `metadata`, `createdAt`).
  - **Enums**: `Role` (`MEMBER`, `COACH`, `ADMIN`, `OWNER`), `AccountStatus` (`ACTIVE`, `PENDING`, `DISABLED`), `OtpPurpose` (`PASSWORD_RESET`), `OtpStatus` (`ISSUED`, `VERIFIED`, `USED`, `INVALIDATED`).

### 9.3 Migration State
- The directory `prisma/migrations` exists on disk but is currently empty (`[PLACEHOLDER]`).
- No migrations have been created or applied on this branch.

### 9.4 Prisma Client Singleton (`src/config/prisma.js`)
The application exports a single shared `PrismaClient` instance:

```javascript
// src/config/prisma.js
const { PrismaClient } = require('@prisma/client');
const env = require('./env');

const prisma = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
```
- In development (`env.isDev`), warnings and errors are logged.
- In production, only errors are logged to avoid query overhead.

### 9.5 Repository-Layer Convention
1. **Direct Dependency**: All database operations must be isolated inside repository files located under `src/repositories/*.repository.js`.
2. **Prisma Import**: Repositories directly import the singleton:
   ```javascript
   const prisma = require('../config/prisma');
   ```
3. **Encapsulation**: Controllers and services must **never** import `prisma` directly. They call repository methods (e.g. `userRepository.findByEmail(email)`), ensuring database logic is decoupled from application logic.

---

## 10. Server Lifecycle

Application startup and shutdown orchestration is handled in `src/server.js`.

### 10.1 Startup Order
1. **Configuration Initialization**: Evaluates `env.js`, ensuring environment integrity before anything else runs.
2. **Database Verification**: Executes `await prisma.$connect()`.
   - If connection fails: Logs `logger.fatal({ err: error }, 'Failed to start server')` and immediately terminates process with `process.exit(1)`.
   - If successful: Logs `logger.info('Database connected')`.
3. **App Instantiation**: Calls `createApp()` to configure Express and middlewares.
4. **Network Listener**: Binds to `env.PORT` (`server = app.listen(env.PORT, ...)`).
5. **Readiness**: Logs `Server listening on port <PORT> (<NODE_ENV>)`.

### 10.2 Graceful Shutdown
The shutdown handler guarantees that inflight HTTP requests are completed and database connections are closed cleanly.

- **Shutdown Timeout**: `SHUTDOWN_TIMEOUT_MS = 10000` (10 seconds).
- **Concurrency Guard**: `let shuttingDown = false;` prevents overlapping shutdown procedures.
- **Forced Exit Timer**: A 10-second `setTimeout` is armed with `.unref()`. If cleanup hangs, `process.exit(1)` is forced.
- **Teardown Sequence**:
  1. `server.close()` stops receiving new HTTP traffic and awaits pending responses.
  2. `await prisma.$disconnect()` terminates the database connection pool.
  3. `logger.info('Shutdown complete')` confirms clean exit.
  4. Process terminates via `process.exit(exitCode)`.

### 10.3 Process Signals & Termination Handlers
`src/server.js` listens for four termination triggers:

```javascript
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
```

---

## 11. Tooling & Development Scripts

### 11.1 ESLint Configuration (`eslint.config.js`)
Configured using ESLint 9+ flat configuration format:
- **Base**: `@eslint/js` recommended configuration (`js.configs.recommended`).
- **Formatting**: `eslint-config-prettier` to prevent style rule collisions.
- **Language Options**: `sourceType: 'commonjs'`, `ecmaVersion: 2022`, `globals: { ...globals.node }`.
- **Target Files**: All `**/*.js`.
- **Test Overrides**: Files under `tests/**/*.js` include `{ globals: { ...globals.jest } }`.
- **Ignored Directories**: `['node_modules/', 'coverage/', 'dist/', 'prisma/migrations/', '.kilo/']`.
- **Enforced Rules**:
  - `'no-console': 'error'` — Disallows `console.log`. All logging must use Pino (exception made only in `env.js` before logger initialization).
  - `'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]` — Forbids unused variables while permitting unused function arguments prefixed with an underscore (`_next`, `_req`).
  - `'eqeqeq': ['error', 'always']` — Enforces strict equality `===` and `!==`.
  - `'prefer-const': 'error'` — Requires `const` for variables never reassigned.
  - `'no-var': 'error'` — Prohibits legacy `var` declarations.

### 11.2 Prettier Configuration (`.prettierrc`)
- `singleQuote: true` — Single quotes for strings.
- `semi: true` — Explicit semicolons at end of statements.
- `trailingComma: 'all'` — Multi-line trailing commas on objects, arrays, and parameters.
- `printWidth: 100` — Line wrap target of 100 characters.
- `tabWidth: 2` — 2 spaces indentation.
- `arrowParens: 'always'` — Parentheses around single-argument arrow functions `(x) => x`.
- `endOfLine: 'lf'` — Unix line feed line endings.

### 11.3 EditorConfig (`.editorconfig`)
- All files: `charset = utf-8`, `end_of_line = lf`, `indent_style = space`, `indent_size = 2`, `insert_final_newline = true`, `trim_trailing_whitespace = true`.
- Markdown (`*.md`): `trim_trailing_whitespace = false` (preserves markdown hard breaks).

### 11.4 Jest Configuration (`jest.config.js`)
- `testEnvironment: 'node'` — Node.js runtime environment.
- `roots: ['<rootDir>/tests']` — Test discovery restricted to `tests/` directory.
- `clearMocks: true` — Automatically clears mock calls, instances, and results between tests.

### 11.5 npm Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `nodemon src/server.js` | Starts server in development mode with automatic restarts on file changes. |
| `npm start` | `node src/server.js` | Runs the production server process directly via Node. |
| `npm test` | `jest --runInBand` | Runs Jest test suites sequentially (single-band) to avoid database test race conditions. |
| `npm run lint` | `eslint .` | Runs static analysis checks across the codebase. |
| `npm run lint:fix` | `eslint . --fix` | Automatically fixes all auto-fixable ESLint errors. |
| `npm run format` | `prettier --write .` | Formats all supported files in-place using Prettier rules. |
| `npm run prisma:generate` | `prisma generate` | Generates the `@prisma/client` library based on `schema.prisma`. |
| `npm run prisma:migrate` | `prisma migrate dev` | Creates new database migrations and applies pending ones in development. |

---

## 12. Architecture & Conventions

### 12.1 Layering Rules

```text
┌────────────────────────────────────────────────────────┐
│                      Route Layer                       │
│  - Receives HTTP request path & method                 │
│  - Attaches validation & auth middlewares              │
│  - Forwards execution to Controller                    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Controller Layer                     │
│  - Extracts params, query, and body                    │
│  - Delegates domain processing to Service              │
│  - Formats HTTP response status & payload              │
│  - NEVER queries database directly                     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                    Service Layer                       │
│  - Pure business logic & orchestrations                │
│  - Cryptographic operations (hashing, tokens)          │
│  - Throws operational errors via createAppError        │
│  - NO knowledge of Express req / res objects           │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Repository Layer                     │
│  - Direct data access layer                            │
│  - Only layer permitted to import prisma singleton     │
│  - Executes Prisma queries & returns raw domain data   │
└────────────────────────────────────────────────────────┘
```

### 12.2 Naming Conventions
- **Layer Folders**: Code is organised by layer under `src/` (`controllers/`, `services/`, `repositories/`, `validators/`, `routes/`); files are grouped by feature through their name prefix (e.g. `auth.*`, `staff.*`, `user.*`). `src/modules/` no longer exists.
- **File Suffixes**: Explicit role-based dot suffixes:
  - Controllers: `<feature>.controller.js`
  - Services: `<feature>.service.js`
  - Repositories: `<feature>.repository.js`
  - Validations: `<feature>.validation.js`
  - Routes: `<feature>.routes.js`
  - Middlewares: `<feature>.middleware.js`
  - Utilities: `<feature>.util.js`
- **Functional Style**: Use functional compositions and factory functions (e.g. `createApp`, `createAppError`, arrow functions, named utility functions) rather than OOP class hierarchies.

### 12.3 Step-by-Step: Adding a New Feature Module

Follow this workflow to add a new domain module (e.g. `members`):

1. **Create Module Folder**:
   ```bash
   # no feature folder: add one file per layer folder (steps 2-6)
   ```

2. **Define Validation Schema (`src/validators/members.validation.js`)**:
   Define request validation using `zod`:
   ```javascript
   const { z } = require('zod');

   const createMemberSchema = z.object({
     body: z.object({
       firstName: z.string().min(1),
       lastName: z.string().min(1),
       email: z.string().email(),
     }),
   });

   module.exports = { createMemberSchema };
   ```

3. **Implement Repository Layer (`src/repositories/members.repository.js`)**:
   Query Prisma directly:
   ```javascript
   const prisma = require('../config/prisma');

   const findById = async (id) => {
     return prisma.user.findUnique({ where: { id } });
   };

   const create = async (data) => {
     return prisma.user.create({ data });
   };

   module.exports = { findById, create };
   ```

4. **Implement Service Layer (`src/services/members.service.js`)**:
   Implement domain validation, hashing, or business logic:
   ```javascript
   const { createAppError } = require('../errors/AppError');
   const membersRepository = require('../services/members.repository');

   const getMember = async (id) => {
     const member = await membersRepository.findById(id);
     if (!member) {
       throw createAppError(404, 'Member not found', 'MEMBER_NOT_FOUND');
     }
     return member;
   };

   module.exports = { getMember };
   ```

5. **Implement Controller Layer (`src/controllers/members.controller.js`)**:
   Receive HTTP inputs, invoke the service, and return responses:
   ```javascript
   const membersService = require('../services/members.service');

   const getMember = async (req, res, next) => {
     try {
       const member = await membersService.getMember(req.params.id);
       res.status(200).json({ success: true, data: member });
     } catch (error) {
       next(error);
     }
   };

   module.exports = { getMember };
   ```

6. **Declare Routes (`src/routes/members.routes.js`)**:
   ```javascript
   const { Router } = require('express');
   const membersController = require('../services/members.controller');

   const router = Router();

   router.get('/:id', membersController.getMember);

   module.exports = router;
   ```

7. **Mount in `src/routes/v1.js`**:
   ```javascript
   // src/routes/v1.js
   const membersRoutes = require('../services/members.routes');
   router.use('/members', membersRoutes);
   ```

8. **Add Integration Tests (`tests/integration/members.test.js`)**:
   Test endpoint behaviors using Supertest.

---

## 13. Setup Guide for a New Developer

### 13.1 Prerequisites
Ensure the following tools are installed on your machine:
- **Node.js**: Version `>= 20.0.0` (LTS v20 or v22 recommended)
- **npm**: Version `>= 10.0.0`
- **PostgreSQL**: Version `>= 15.0` (running locally on port 5432 or via Docker)
- **Git**

### 13.2 Step-by-Step Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/spirit-level-App/Backend.git
   cd Backend
   ```

2. **Checkout the Active Working Branch**:
   ```bash
   git checkout javascriptconversiondaniyalkhan
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Configure Environment Variables**:
   Copy the `.env.example` template:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your PostgreSQL credentials:
   ```env
   NODE_ENV=development
   PORT=5000
   LOG_LEVEL=debug
   CORS_ORIGINS=*
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/spirit_level_dev?schema=public"
   ```

5. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

6. **Run Database Migrations**:
   *(Note: Models must be added to `prisma/schema.prisma` before migration)*
   ```bash
   npm run prisma:migrate
   ```

7. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   You should see:
   ```text
   [HH:MM:ss] INFO: Database connected
   [HH:MM:ss] INFO: Server listening on port 5000 (development)
   ```

8. **Verify Service Health via curl**:
   In another terminal:
   ```bash
   # Verify liveness:
   curl http://localhost:5000/health
   # Expected output: {"status":"ok","uptime":...,"timestamp":"..."}

   # Verify database readiness:
   curl http://localhost:5000/health/ready
   # Expected output: {"status":"ready","db":"up"}
   ```

9. **Run Code Quality Checks**:
   ```bash
   npm run lint
   npm run format
   ```

---

## 14. Extension Points

The codebase contains designated architectural extension points for upcoming infrastructure services:

### 14.1 Redis Caching (`src/infra/cache/`)
- **Current State**: `src/infra/cache/` contains `.gitkeep` (`[PLACEHOLDER]`).
- **Intended Placement**:
  - Redis connection client: `src/infra/cache/redis.client.js`.
  - Cache helper service: `src/infra/cache/cache.service.js` (e.g. `get`, `set`, `del`, `ttl`).
  - Cache middleware: `src/middlewares/cache.middleware.js` for caching static or semi-static route responses.

### 14.2 Message Queues / RabbitMQ (`src/infra/queue/`)
- **Current State**: Contains `producers/.gitkeep` and `consumers/.gitkeep` (`[PLACEHOLDER]`).
- **Intended Placement**:
  - Connection manager: `src/infra/queue/rabbitmq.client.js`.
  - Message Producers: `src/infra/queue/producers/<event>.producer.js` for publishing events (e.g., `user-registered.producer.js`, `password-reset.producer.js`).
  - Message Consumers: `src/infra/queue/consumers/<event>.consumer.js` for asynchronous workers (e.g., sending emails, audit processing).

### 14.3 API Documentation / Swagger (`src/docs/`)
- **Current State**: `src/docs/` contains `.gitkeep` (`[PLACEHOLDER]`).
- **Intended Placement**:
  - OpenAPI Specification: `src/docs/openapi.yaml` or `src/docs/swagger.json`.
  - Swagger UI Router: Route mounted at `/api/docs` using `swagger-ui-express`.

### 14.4 Containerization / Docker
- **Current State**: Not yet added (`[PLANNED]`).
- **Intended Placement**:
  - `Backend/Dockerfile`: Multi-stage production container build (builder & runtime stages based on `node:22-alpine`).
  - `Backend/.dockerignore`: Excludes `node_modules`, `.env`, `.git`, `.kilo`, and `tests/`.
  - `Backend/docker-compose.yml`: Local multi-container stack provisioning PostgreSQL, Redis, and RabbitMQ.

---

## 15. Implementation Status & Issues Found

### 15.1 Implementation Checklist

#### Core Infrastructure & App Lifecycle
- `[IMPLEMENTED]` Server entry point with boot & graceful shutdown (`src/server.js`)
- `[IMPLEMENTED]` Express application factory with middleware stack (`src/app.js`)
- `[IMPLEMENTED]` Zod runtime environment variable validation (`src/config/env.js`)
- `[IMPLEMENTED]` Structured Pino logger & Pino-HTTP with redactions (`src/config/logger.js`)
- `[IMPLEMENTED]` Prisma Client singleton (`src/config/prisma.js`)
- `[IMPLEMENTED]` Operational error factory `createAppError` (`src/errors/AppError.js`)
- `[IMPLEMENTED]` Catch-all 404 handler (`src/middlewares/notFound.middleware.js`)
- `[IMPLEMENTED]` Global error handling middleware (`src/middlewares/errorHandler.middleware.js`)
- `[IMPLEMENTED]` Health check endpoints: `/health` & `/health/ready` (`src/routes/health.routes.js`)
- `[IMPLEMENTED]` Root router (`src/routes/index.js`)
- `[IMPLEMENTED]` ESLint 9+ configuration (`eslint.config.js`)
- `[IMPLEMENTED]` Prettier configuration (`.prettierrc`, `.prettierignore`)
- `[IMPLEMENTED]` EditorConfig (`.editorconfig`)
- `[IMPLEMENTED]` Jest configuration (`jest.config.js`)
- `[IMPLEMENTED]` Environment template (`.env.example`)
- `[PLACEHOLDER]` Dependency injection container (`src/config/container.js`)

#### Database & Schema
- `[IMPLEMENTED]` Prisma client generator and datasource configuration (`prisma/schema.prisma`)
- `[PLACEHOLDER]` Prisma domain models and enums (`prisma/schema.prisma` currently has 0 models)
- `[PLACEHOLDER]` Database migration files (`prisma/migrations/` is empty)
- `[PLACEHOLDER]` Database seed script (`prisma/seed.js` is empty)

#### Middlewares
- `[IMPLEMENTED]` Global Error Handler (`src/middlewares/errorHandler.middleware.js`)
- `[IMPLEMENTED]` 404 Route Handler (`src/middlewares/notFound.middleware.js`)
- `[PLACEHOLDER]` Authentication middleware (`src/middlewares/authenticate.middleware.js`)
- `[PLACEHOLDER]` Authorization / RBAC middleware (`src/middlewares/authorize.middleware.js`)
- Rate limiting middleware (`src/middlewares/rateLimiter.middleware.js`)
- `[PLACEHOLDER]` Zod request validation middleware (`src/middlewares/validate.middleware.js`)

#### Feature Modules
- `[PLACEHOLDER]` API v1 router mounting (`src/routes/v1.js` - router exists, routes commented out)
- `[PLACEHOLDER]` Auth module (`auth.controller.js`, `auth.service.js`, `auth.routes.js`, `auth.validation.js`, `otp.repository.js`, `password-reset.repository.js`, `session.repository.js`)
- `[PLACEHOLDER]` Staff module (`staff.controller.js`, `staff.service.js`, `staff.routes.js`, `staff.validation.js`)
- `[PLACEHOLDER]` User module (`user.repository.js`)
- `[PLACEHOLDER]` Audit module (`audit-log.repository.js`)

#### Utilities & Constants
- `[PLACEHOLDER]` Constants (`messages.js`, `roles.js`, `status.js`)
- `[PLACEHOLDER]` Utilities (`apiResponse.util.js`, `asyncHandler.util.js`, `duration.util.js`, `jwt.util.js`, `otp.util.js`, `password.util.js`)
- `[PLACEHOLDER]` Notification service (`src/infra/mail/notify.service.js`)

#### Test Suites
- `[PLACEHOLDER]` `tests/integration/auth.register.test.js` (0-byte file)
- `[PLACEHOLDER]` `tests/integration/auth.login.test.js` (0-byte file)
- `[PLACEHOLDER]` `tests/integration/auth.me.test.js` (0-byte file)
- `[PLACEHOLDER]` `tests/integration/auth.forgot-password.test.js` (0-byte file)
- `[PLACEHOLDER]` `tests/integration/admin.staff.test.js` (0-byte file)

---

### 15.2 Inconsistencies & Issues Found

During analysis of the disk files, several concrete issues and discrepancies were identified:

1. **`npm test` Fails Immediately Due to 0-Byte Test Files**:
   Running `npm test` executes `jest --runInBand` and immediately fails with error:
   ```text
   FAIL tests/integration/auth.register.test.js
   ● Test suite failed to run
     Your test suite must contain at least one test.
   ```
   All 5 integration test files in `tests/integration/` are empty (0 bytes). Jest requires at least one test per suite.

2. **Missing Essential Dependencies in `package.json`**:
   The repository contains placeholder files for `src/utils/password.util.js` and `src/utils/jwt.util.js`, but `bcrypt` and `jsonwebtoken` are missing from `dependencies` in `package.json`. In the previous TypeScript branch (`authorization`), `bcrypt@^5.1.1` and `jsonwebtoken@^9.0.2` were installed. They must be added before implementing these utilities.

3. **Prisma Schema Has No Domain Models**:
   `prisma/schema.prisma` contains only:
   ```prisma
   generator client { provider = "prisma-client-js" }
   datasource db { provider = "postgresql", url = env("DATABASE_URL") }
   ```
   No database tables (`User`, `RefreshTokenSession`, `PasswordResetOtp`, `AuditLog`) are defined in the schema file on disk. Consequently, `npm run prisma:migrate` cannot generate tables.

4. **Empty Database Seed Script**:
   `prisma/seed.js` is 0 bytes, and `package.json` lacks the standard Prisma seed entry:
   ```json
   "prisma": {
     "seed": "node prisma/seed.js"
   }
   ```

5. **Commented API v1 Router**:
   `src/routes/v1.js` contains commented code (`// router.use('/auth', require('./auth.routes'));`) and exports an empty router. No feature modules are exposed to HTTP callers.

6. **All Module Code is Currently 0-Byte Placeholders**:
   The feature files (now under `src/controllers`, `services`, `repositories`, `validators`, `routes`; formerly `src/modules/*`) exist to define directory structure, but all contain 0 bytes. Developers picking up tasks will need to implement controller, service, repository, and validation logic from scratch or port it over from the TypeScript branch.

7. **Documentation Path Duplication**:
   The repository contains `src/docs/.gitkeep` as well as root-level `docs/`. Standard practice recommends keeping markdown guides in `Backend/docs/` and reserving `src/docs/` strictly for machine-readable OpenAPI specs (or consolidating into `Backend/docs/`).
