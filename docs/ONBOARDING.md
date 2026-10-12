# Developer Onboarding Guide — Backend

Welcome to the backend of **Spirit Level**. This guide describes the codebase as it is on disk today (last verified 2026-10-11). For a file-by-file index with exports, test counts and ticket progress, read [CODEMAP.md](./CODEMAP.md) next; this file explains the architecture, the conventions and how to get running.

Status words used below: **implemented** = working code with tests, **placeholder** = file exists but is empty, **not implemented** = does not exist yet.

---

## 1. Overview

- **Project:** `spirit-level-backend` — REST API for the Spirit Level app (members, coaches, admins, owners).
- **Repository:** `https://github.com/spirit-level-App/Backend.git`. Active branch: `javascriptconversiondaniyalkhan` (the code base was converted from TypeScript to plain JavaScript; no TypeScript remains).
- **Runtime:** Node.js `>= 20` (`engines` in `package.json`), CommonJS (`require` / `module.exports`), plain JavaScript, function-based modules, `async/await`.
- **Framework and data:** Express 5, Prisma 6 on PostgreSQL (Neon), Zod 4 for validation.
- **Auth:** email + password login, short-lived JWT access tokens, rotating opaque refresh tokens stored hashed in the database, logout, OTP-based password reset.

## 2. Tech stack

| Package | Purpose |
| :-- | :-- |
| `express` 5 | HTTP routing and middleware |
| `@prisma/client` 6 / `prisma` | ORM, migrations, client generation (PostgreSQL) |
| `zod` 4 | Request body and environment validation |
| `jsonwebtoken` | Access-token signing and verification (HS256 only) |
| `bcrypt` | Password and OTP hashing |
| `express-rate-limit` | Per-IP rate limiting (in-memory store) |
| `helmet`, `cors` | Security headers, CORS allow-list |
| `pino`, `pino-http`, `pino-pretty` (dev) | Structured logging |
| `nodemailer` | SMTP email (staff invitation, password-reset OTP) |
| `@vercel/blob` | Client-side image upload tokens (profile images) |
| `dotenv` | Loads `.env` |
| `jest` 30, `supertest` | Unit and integration tests |
| `eslint` 10 (flat config), `prettier`, `nodemon` | Quality tooling and dev server |

`multer` is not used (uploads go straight from the client to Vercel Blob). Node's built-in `crypto` is used for UUIDs, refresh tokens, temp passwords and SHA-256 hashing.

## 3. Folder structure

```text
Backend/
├── .env.example            template of every environment variable (no secrets); real .env is gitignored
├── eslint.config.js  jest.config.js  package.json  .prettierrc  .editorconfig
├── docs/                   ONBOARDING.md (this file), CODEMAP.md (detailed file index)
├── prisma/
│   ├── schema.prisma       models and enums (section 9)
│   ├── migrations/         10 migrations + migration_lock.toml
│   ├── seed.js, seed-owner.js   first-owner seed (npm run prisma:seed)
├── src/
│   ├── server.js           process entry: connect DB, listen, graceful shutdown
│   ├── app.js              createApp(): middleware pipeline and routes
│   ├── config/             env.js (validation), logger.js, prisma.js (singleton), container.js (placeholder)
│   ├── constants/          messages, errors (AppErrors), roles, status, gender, relationship, audit, upload
│   ├── errors/             AppError.js (createAppError factory)
│   ├── routes/             index, v1, health, auth, staff, uploads
│   ├── controllers/        auth, staff, uploads          (thin HTTP handlers)
│   ├── services/           auth, password-reset, staff, uploads + auth.guards, otp.guards,
│   │                       login.policies, staff.policies (business logic)
│   ├── repositories/       user, session, password-reset, audit-log, staff + user.mapper, staff.mapper
│   ├── validators/         auth, staff, uploads          (Zod schemas, *.validation.js)
│   ├── middlewares/        authenticate, authorize, clientType, errorHandler, notFound, rateLimiter, validate
│   ├── utils/              jwt, token, password, otp, apiResponse, requestMeta, clientType, html
│   │                       (asyncHandler.util.js and duration.util.js are empty placeholders)
│   └── infra/              mail/notify.service, storage/blob.storage (cache/ and queue/ are placeholders)
└── tests/
    ├── helpers/            testData.helper (creates and cleans test users), auth.helper (bearerFor)
    ├── integration/        24 files, hit the real database through supertest
    └── unit/               42 files, no database
```

Layering rule: **route → validate → controller → service → repository → Prisma**. Only repositories (and the transaction in `staff.service`) talk to Prisma. Controllers never contain business logic.

## 4. Request lifecycle

`src/app.js` registers, in this order:

1. `x-powered-by` disabled; `trust proxy` set from `TRUST_PROXY`.
2. `helmet()`.
3. `cors()` — `*` in development/test; in production an allow-list from `CORS_ORIGINS`. Requests without an `Origin` header (mobile apps, curl) are allowed. No cookies are used.
4. `clientType` — sets `req.clientType` (`web` / `mobile` / `unknown`) for logging only; never use it for security.
5. `pino-http` request logging (health routes are not logged).
6. `express.json({ limit: '1mb' })` and `express.urlencoded`.
7. Routes (`/health`, `/api/v1/...`), then `notFound`, then `errorHandler`.

Inside a route: rate limiter → `validateBody(schema)` (Zod; unknown keys are stripped) → controller → service → repository. Errors go to `next(err)` and end in `errorHandler`.

## 5. Configuration and environment

All variables are validated by Zod in `src/config/env.js` at startup. Invalid or missing values print a per-variable list and the process exits with code 1. Never commit `.env`; never paste secrets into issues or logs.

| Variable | Default | Rules / purpose |
| :-- | :-- | :-- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `PORT` | `5000` | positive integer |
| `LOG_LEVEL` | `info` | pino level or `silent` |
| `DATABASE_URL` | — | **required**; PostgreSQL connection string |
| `CORS_ORIGINS` | `*` | bare origins, comma separated; wildcard/empty refused in production |
| `TRUST_PROXY` | `false` | set to the number of proxy hops (e.g. `1`) behind a reverse proxy, **not** `true` |
| `BCRYPT_SALT_ROUNDS` | `12` | |
| `JWT_ACCESS_SECRET` | — | **required**; at least 32 characters; placeholder-looking values (`CHANGE_ME`, `your_secret`, ...) are rejected |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | positive whole number + `s`, `m`, `h` or `d` (`15m`, `1h`, `7d`); bare numbers like `900` are rejected |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | refresh-token lifetime |
| `REFRESH_SESSION_CLEANUP_GRACE_DAYS` | `7` | must be > 0; how long expired/revoked sessions are kept |
| `REFRESH_RATE_LIMIT_WINDOW_MS` / `REFRESH_RATE_LIMIT_MAX` | 15 min / 60 | limit for `/auth/refresh` + `/auth/logout` per IP (raised automatically when `NODE_ENV=test`; keep `REFRESH_RATE_LIMIT_MAX` unset in the test `.env`) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 15 min / 1000 | limit for the other auth routes per IP |
| `OTP_EXPIRY_MINUTES` / `OTP_MAX_ATTEMPTS` | `10` / `5` | password-reset OTP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | — / `false` | required unless `NODE_ENV=test` |
| `BLOB_READ_WRITE_TOKEN` | unset | Vercel Blob token; without it the upload-token endpoint returns 503 |
| `SEED_OWNER_EMAIL`, `_PASSWORD`, `_FULL_NAME`, `_PHONE` | — | used only by `npm run prisma:seed`, not read by the app |

The jest run uses the same `.env` as development (there is no separate test env file).

## 6. Logging

`src/config/logger.js` (pino). Level comes from `LOG_LEVEL`; silent in tests; `pino-pretty` in development, JSON in production. `Authorization`, `Cookie` and `password` fields are redacted. Never log tokens, OTPs, password hashes or reset tokens; the code logs only error names/codes for failures it swallows.

## 7. Error handling and response format

- Success: `{ "success": true, "message": "...", "data": ... }` (`utils/apiResponse.util.js`).
- Error: `{ "success": false, "message": "...", "errors": [...] }`; `errors` only appears for validation failures (`[{ field, message }]`).
- Expected failures are thrown with `createAppError(AppErrors.X)` (`errors/AppError.js`, definitions in `constants/errors.js`: status code, message, code). The `code` is internal; clients currently tell errors apart by status and message.
- `errorHandler` maps: malformed JSON → 400, `ZodError` → 400, Prisma unique violation → 409, operational `AppError` → its own status, anything else → generic 500 (details are logged, never returned).
- All user-facing text lives in `constants/messages.js`; do not write message literals in validators or services.

## 8. API endpoints

Base path `/api/v1`. "Bearer" = `Authorization: Bearer <access token>` through the `authenticate` middleware.

| Method and path | Auth | Rate limit | Notes |
| :-- | :-- | :-- | :-- |
| `GET /health`, `GET /health/ready` | — | — | liveness; readiness checks the DB |
| `POST /auth/register` | — | shared auth limiter | creates a PENDING member |
| `POST /auth/register/complete` | — | shared auth limiter | emergency contact + waiver, PENDING → ACTIVE |
| `POST /auth/login` | — | shared auth limiter | returns `{ user, tokens }` |
| `POST /auth/refresh` | — | refresh limiter (60 / 15 min) | body `{ refreshToken }`; rotates the refresh token |
| `POST /auth/logout` | Bearer | refresh limiter | body `{ refreshToken }` (the refresh token to end) plus the access token as Bearer; always 200 for an authenticated caller |
| `POST /auth/forgot-password` | — | own limiter | always the same generic 200 |
| `POST /auth/verify-otp` | — | own limiter | returns a one-time `resetToken` |
| `POST /auth/reset-password` | — | own limiter | also revokes all refresh sessions |
| `POST /uploads/profile-image/token` | — | own limiter | Vercel Blob client-upload token |
| `PATCH /uploads/profile-image` | Bearer | — | updates the profile image URL |
| `GET /auth/me` | Bearer (any active role) | — | profile of the caller (public fields only) |
| `POST /admin/staff` | Bearer + ADMIN/OWNER | — | creates a MEMBER, COACH, ADMIN or OWNER user (what each caller may create: `services/staff.policies.js`) and emails a temporary password |

Not implemented: change-password, any endpoint that lists or revokes sessions.

## 9. Authentication in detail

**Login** (`auth.service.loginWithPassword`): look up the user → bcrypt-compare (against a dummy hash when the email is unknown, so timing does not leak) → only then check the account status (PENDING → 403, DISABLED → 403) → in one transaction update `lastLoginAt`, store the refresh session and write a `LOGIN_SUCCESS` audit row. Wrong email and wrong password give the identical 401.

**Access token** (`utils/jwt.util.js`): HS256 only, signed with `JWT_ACCESS_SECRET`, claims `sub` (user id), `email`, `role`, `type: "access"`, `iat`, `exp`. Verification pins the algorithm and rejects any token whose `type` is not `access`.

**Authorization:** `authorize(...roles)` (after `authenticate`) lets a request through only if `req.user.role` (loaded from the DB, never from the body, query, a header or the token's `role` claim) is listed; otherwise 403 with the generic `FORBIDDEN` message, and one warning log line with user id, role, method, URL without query, IP, client type and timestamp. It throws when registered with an unknown role name. There is no role ranking: list every allowed role.

**`authenticate` middleware:** reads the Bearer token (missing → 401), verifies it (expired → 401 `TOKEN_EXPIRED`, anything else invalid → 401 `INVALID_TOKEN`), then loads the user from the database and takes **role and status from the database, not from the token**. Disabled or pending users get 403. `authorize(...roles)` runs after it.

**Refresh token** (`utils/token.util.js`): 32 random bytes, base64url (43 characters). Only its SHA-256 hash is stored in `RefreshSession`, with user id, expiry, IP and user agent. A user can have many active sessions (one per login/device).

**Refresh** (`auth.service.refreshTokens`): unknown token → 401; **revoked token presented again → all of that user's sessions are revoked and 401** (reuse detection); expired → 401; user missing → 401; user pending/disabled → 403. Otherwise, in one transaction, the old session is revoked and a new one created (`session.repository.rotate`), and a new access + refresh token pair is returned. If two requests race with the same token, exactly one wins; the other gets a plain 401 without revoking everything.

**Logout** (`auth.service.logout`, behind `authenticate`): in one transaction (`session.repository.revokeSessionWithLogoutAuditTx`) it revokes the session of the presented refresh token **only if that session belongs to the authenticated user** and writes one `LOGOUT` audit row (user id, email, IP, user agent; no tokens). Unknown, foreign, expired-and-revoked or already revoked tokens change nothing, write no audit row and get the same 200 response, so nothing leaks and repeated logouts are idempotent. Only that one session ends; the user's other devices keep working. Without a valid access token the call is a 401 (checked before the body), so a client whose access token has expired must refresh first.

**Password reset:** `forgot-password` (4-digit OTP, bcrypt-hashed, emailed in the background) → `verify-otp` (attempt limit, returns a one-time `resetToken` (only its SHA-256 hash is stored)) → `reset-password` (changes the password and revokes **all** active refresh sessions in the same transaction). Checks live in `services/otp.guards.js` (Chain of Responsibility).

**Known limits:** an access token already issued stays valid until it expires (default 15 minutes) even after logout or a password reset, because `authenticate` does not check sessions (a session id in the token was deliberately not added). A refresh token that was logged out and is later presented to `/auth/refresh` counts as reuse and revokes all of that user's sessions. Expired and revoked `RefreshSession` rows are not deleted automatically yet: `session.repository.deleteStaleSessions` exists but nothing calls it (a runner has not been built).

## 10. Database

- Prisma 6 with PostgreSQL. Models: `User`, `EmergencyContact`, `RefreshSession`, `AuditLog`, `PasswordResetOtp`. Enums: `Role` (MEMBER, COACH, ADMIN, OWNER), `AccountStatus` (PENDING, ACTIVE, DISABLED), `Gender`, `Relationship`, `AuditAction` (LOGIN_SUCCESS, LOGIN_FAILED, STAFF_CREATED, STAFF_CREATE_DENIED, four PASSWORD_RESET_* values, LOGOUT), `LoginFailureReason`.
- Ids are UUIDs generated by the application (`crypto.randomUUID()`), not by the database.
- 10 migrations in `prisma/migrations/`, all applied to the shared Neon database (`npx prisma migrate status` reports it up to date).
- Repositories are the only layer that imports `config/prisma.js`. Multi-step writes (login session, refresh rotation, password reset, staff creation, registration completion) use interactive transactions so they commit all or nothing.
- The database is remote: a query takes about 300 ms and an interactive transaction about 1.5 s. Do not shorten test timeouts.

## 11. Server lifecycle

`src/server.js`: validate env → `prisma.$connect()` (exit 1 on failure) → `createApp()` → listen on `PORT`. On `SIGTERM`, `SIGINT`, `unhandledRejection` and `uncaughtException` it stops accepting requests, disconnects Prisma and exits; a 10-second timer forces exit if cleanup hangs.

## 12. Conventions

- Layer folders with feature-prefixed file names: `<feature>.controller.js`, `.service.js`, `.repository.js`, `.validation.js`, `.routes.js`, `.middleware.js`, `.util.js`.
- Function-based code (factories and plain functions), no classes. Strategy (`login.policies`, `staff.policies`, `Map`-based, deny by default) and Chain of Responsibility (`auth.guards`, `otp.guards`) are the patterns in use.
- ESLint (flat config): `no-console`, `eqeqeq`, `prefer-const`, `no-var`, unused variables are errors (prefix with `_` to ignore). Prettier: single quotes, semicolons, trailing commas, width 100, LF line endings (on Windows the working copy may show CRLF; use `prettier --check --end-of-line auto`).
- Reuse before writing: search validators, messages, repositories and test helpers first.
- To add a feature: validator (`validators/x.validation.js`) → repository → service → controller → route file → mount it in `routes/v1.js` → integration test.

## 13. Setup

1. Install Node 20+ and get a PostgreSQL database (the team uses a shared Neon database; ask for its connection string).
2. `npm install`
3. `cp .env.example .env` and fill it in. **The app refuses to start until `JWT_ACCESS_SECRET` is replaced** with a random value (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), and SMTP variables are required outside tests. Leave `REFRESH_RATE_LIMIT_MAX` commented out in the `.env` you run tests with.
4. `npm run prisma:generate`; with a fresh local database also `npm run prisma:migrate`. Do not run `migrate dev` against the shared database without agreeing it with the team.
5. Optional first owner: set the `SEED_OWNER_*` variables and run `npm run prisma:seed`.
6. `npm run dev`, then `curl http://localhost:5000/health` and `/health/ready`.

On Windows use `npx.cmd` instead of `npx` for local tools.

## 14. Testing

- `npm test` = `jest --runInBand` (sequential, because integration suites share one database). A full run takes about 10–12 minutes against the remote database; run a single suite with `npx jest --runInBand tests/integration/auth.refresh.test.js`.
- **Unit tests** (`tests/unit`) mock repositories and need no database. **Integration tests** (`tests/integration`) call the real app with supertest and the real database; each suite creates its own users with `tests/helpers/testData.helper.js` (`createTestData(label)` → `createUser()`, `cleanup()`) and deletes them afterwards. Set `jest.setTimeout(30000)` or more in DB suites.
- `tests/helpers/auth.helper.js` `bearerFor(user)` gives a Bearer header for protected-route tests.
- Rate-limit tests build an isolated app with `jest.isolateModules` and small limits.
- Known state: every suite passes (there is no empty placeholder suite any more).
- Other checks: `npm run lint`, `npm run format`.

## 15. Extension points and what is not built

- Placeholders: `src/config/container.js`, `src/utils/asyncHandler.util.js`, `src/utils/duration.util.js`, `src/infra/cache/`, `src/infra/queue/`, `src/docs/` (API documentation).
- Not implemented: change-password (and enforcement of `mustChangePassword`), logout from all devices, a job to delete stale refresh sessions, revocation of already issued access tokens, Docker files.
- Operational reminders: set `TRUST_PROXY` correctly behind a proxy; rate-limit counters are in memory per process; do not run destructive scripts against the shared database.
