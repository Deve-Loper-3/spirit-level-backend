// Pattern: Strategy — one login policy per account status.
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AccountStatus } = require('../constants/status');

const allow = () => {};

const rejectWith = (appError) => () => {
  throw createAppError(appError);
};

const denyByDefault = rejectWith(AppErrors.ACCOUNT_DISABLED);

// To support a new status, add one entry here. Unlisted statuses are rejected, never allowed.
// A Map (not a plain object) so inherited keys like "constructor" can never match a policy.
const loginPolicies = new Map([
  [AccountStatus.ACTIVE, allow],
  [AccountStatus.PENDING, rejectWith(AppErrors.REGISTRATION_INCOMPLETE)],
  [AccountStatus.DISABLED, rejectWith(AppErrors.ACCOUNT_DISABLED)],
]);

const assertCanLogin = (user) => {
  const policy = loginPolicies.get(user.status) ?? denyByDefault;
  policy(user);
};

module.exports = { assertCanLogin };
