const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../config/logger');
const { hashPassword, comparePassword } = require('../utils/password.util');
const { signAccessToken } = require('../utils/jwt.util');
const { generateRefreshToken, hashToken } = require('../utils/token.util');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');
const { Role } = require('../constants/roles');
const { AccountStatus } = require('../constants/status');
const { LoginFailureReason } = require('../constants/audit');
const {
  findByEmail,
  createUser,
  findById,
  findForLogin,
  findAuthWithEmailById,
  completeRegistrationTx,
} = require('../repositories/user.repository');
const { toPublicUser, toCompletedRegistration } = require('../repositories/user.mapper');
const {
  createLoginSessionTx,
  findByTokenHash,
  revokeAllByUser,
  revokeSessionWithLogoutAuditTx,
  rotate,
} = require('../repositories/session.repository');
const { recordLoginFailure } = require('../repositories/audit-log.repository');
const { registrationGuards, runGuards } = require('./auth.guards');
const { assertCanLogin } = require('./login.policies');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const registerMember = async ({
  fullName,
  email,
  phone,
  whatsappNumber,
  gender,
  birthDay,
  birthMonth,
  profileImageUrl,
  password,
}) => {
  const existing = await findByEmail(email);

  if (existing) throw createAppError(409, Messages.USER_ALREADY_EXISTS);

  const passwordHash = await hashPassword(password);

  const user = await createUser({
    id: crypto.randomUUID(),
    fullName,
    email,
    phone,
    whatsappNumber: whatsappNumber ?? null,
    gender,
    birthDay: birthDay ?? null,
    birthMonth: birthMonth ?? null,
    profileImageUrl: profileImageUrl ?? null,
    passwordHash,
    role: Role.MEMBER,
    status: AccountStatus.PENDING,
  });

  return toPublicUser(user);
};

const completeMemberRegistration = async (input) => {
  const user = await findById(input.registrationId);
  runGuards(registrationGuards, { user, input });
  const now = new Date();
  const result = await completeRegistrationTx({
    userId: user.id,
    contact: input.emergencyContact,
    now,
  });
  return toCompletedRegistration(result);
};

// Compared against when the email is unknown, so response time does not reveal whether it exists.
// Created lazily once, with the same cost factor as real password hashes.
let dummyHashPromise;
const getDummyHash = () => {
  dummyHashPromise ??= hashPassword(crypto.randomUUID());
  return dummyHashPromise;
};

// A failed audit write must never change the login response, so it is only logged.
const recordFailureSafely = async (failure) => {
  try {
    await recordLoginFailure(failure);
  } catch (err) {
    logger.error(
      { reason: failure.reason, userId: failure.userId, errorName: err.name, errorCode: err.code },
      Messages.LOGIN_AUDIT_WRITE_FAILED,
    );
  }
};

// Any status other than PENDING is treated as disabled, matching the deny-by-default policy.
const failureReasonForStatus = (status) =>
  status === AccountStatus.PENDING
    ? LoginFailureReason.ACCOUNT_PENDING
    : LoginFailureReason.ACCOUNT_DISABLED;

const ensureStatusAllowsLogin = async (user, email, meta) => {
  try {
    assertCanLogin(user);
  } catch (err) {
    await recordFailureSafely({
      userId: user.id,
      email,
      reason: failureReasonForStatus(user.status),
      meta,
    });
    throw err;
  }
};

const startLoginSession = async (user, meta) => {
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY);

  await createLoginSessionTx({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    now,
    meta,
  });

  return {
    accessToken: signAccessToken({ userId: user.id, email: user.email, role: user.role }),
    accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
};

// Order matters: password first, status second, so account status is never revealed
// to someone who does not know the password.
const loginWithPassword = async ({ email, password }, meta) => {
  const user = await findForLogin(email);
  const passwordMatches = await comparePassword(
    password,
    user?.passwordHash ?? (await getDummyHash()),
  );

  if (!user || !passwordMatches) {
    await recordFailureSafely({
      userId: user?.id,
      email,
      reason: LoginFailureReason.INVALID_CREDENTIALS,
      meta,
    });
    throw createAppError(AppErrors.INVALID_CREDENTIALS);
  }

  await ensureStatusAllowsLogin(user, email, meta);
  const tokens = await startLoginSession(user, meta);

  return { user: toPublicUser(user), tokens };
};

// A revoked token was presented again, so it may have been stolen: close every session of the
// user and reject. Same 401 as any other bad token.
const rejectReusedToken = async (userId) => {
  await revokeAllByUser(userId);
  throw createAppError(AppErrors.INVALID_TOKEN);
};

// Finds the session of a presented refresh token and rejects unknown, reused and expired ones.
const findUsableSession = async (refreshToken, now) => {
  const session = await findByTokenHash(hashToken(refreshToken));
  if (!session) throw createAppError(AppErrors.INVALID_TOKEN);
  if (session.revokedAt) await rejectReusedToken(session.userId);
  if (session.expiresAt <= now) throw createAppError(AppErrors.TOKEN_EXPIRED);
  return session;
};

// Email, role and status come from the DB, like in `authenticate`. A missing user looks like a bad token.
const loadUserForRefresh = async (userId) => {
  const user = await findAuthWithEmailById(userId);
  if (!user) throw createAppError(AppErrors.INVALID_TOKEN);
  assertCanLogin(user);
  return user;
};

// Swaps the presented refresh token for a new access + refresh token (rotation).
// `rotate` returns null when another request used the same token first: plain 401, no revoke-all,
// so a double-click from one client does not log the user out everywhere.
const refreshTokens = async (refreshToken, meta) => {
  const now = new Date();
  const session = await findUsableSession(refreshToken, now);
  const user = await loadUserForRefresh(session.userId);

  const newRefreshToken = generateRefreshToken();
  const expiresAt = new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY);
  const rotated = await rotate(
    session.id,
    { userId: user.id, tokenHash: hashToken(newRefreshToken), expiresAt, meta },
    now,
  );
  if (!rotated) throw createAppError(AppErrors.INVALID_TOKEN);

  return {
    accessToken: signAccessToken({ userId: user.id, email: user.email, role: user.role }),
    accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
};

// `user` is the authenticated caller (req.user). Revokes the session of the presented refresh
// token only if it belongs to that user, and writes one LOGOUT audit row (same transaction).
// Idempotent and silent: an unknown, foreign or already revoked token does nothing and writes
// nothing, so the response never says whether the token was valid. A revoked token here is not a
// theft signal (the client may simply log out twice), so no revoke-all.
const logout = async (refreshToken, user, meta) => {
  await revokeSessionWithLogoutAuditTx({
    tokenHash: hashToken(refreshToken),
    userId: user.id,
    meta,
  });
};

module.exports = {
  registerMember,
  completeMemberRegistration,
  loginWithPassword,
  refreshTokens,
  logout,
};
