// Pattern: Chain of Responsibility — add new guards as sync functions ({ user, input }) that throw createAppError(AppErrors.X) or return, then append to registrationGuards.
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { AccountStatus } = require('../constants/status');

const ensureUserExists = ({ user }) => {
  if (!user) {
    throw createAppError(AppErrors.USER_NOT_FOUND);
  }
};

const ensureNotActive = ({ user }) => {
  if (user.status === AccountStatus.ACTIVE) {
    throw createAppError(AppErrors.REGISTRATION_ALREADY_COMPLETED);
  }
};

const ensurePending = ({ user }) => {
  if (user.status !== AccountStatus.PENDING) {
    throw createAppError(AppErrors.ACCOUNT_NOT_ELIGIBLE);
  }
};

const ensureEmergencyPhoneDiffers = ({ user, input }) => {
  if (input?.emergencyContact?.phone && user?.phone && input.emergencyContact.phone === user.phone) {
    throw createAppError(AppErrors.EMERGENCY_PHONE_SAME_AS_MEMBER);
  }
};

const registrationGuards = [
  ensureUserExists,
  ensureNotActive,
  ensurePending,
  ensureEmergencyPhoneDiffers,
];

const runGuards = (guards, ctx) => {
  for (const guard of guards) {
    guard(ctx);
  }
};

module.exports = {
  ensureUserExists,
  ensureNotActive,
  ensurePending,
  ensureEmergencyPhoneDiffers,
  registrationGuards,
  runGuards,
};
