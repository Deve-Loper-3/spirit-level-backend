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
  completeRegistrationTx,
} = require('../repositories/user.repository');
const { toPublicUser, toCompletedRegistration } = require('../repositories/user.mapper');
const { createLoginSessionTx } = require('../repositories/session.repository');
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
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
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

module.exports = { registerMember, completeMemberRegistration, loginWithPassword };
