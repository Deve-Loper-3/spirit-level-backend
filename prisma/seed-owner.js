// Owner seed logic. The first OWNER is created only here, never through the API.
const crypto = require('crypto');
const z = require('zod');
const { findByEmail, createUser } = require('../src/repositories/user.repository');
const { fullNameField, emailField, phoneField } = require('../src/validators/auth.validation');
const {
  hashPassword,
  PASSWORD_REGEX,
  PASSWORD_POLICY_MESSAGE,
} = require('../src/utils/password.util');
const { createAppError } = require('../src/errors/AppError');
const { Messages } = require('../src/constants/messages');
const { Role } = require('../src/constants/roles');
const { AccountStatus } = require('../src/constants/status');
const { STAFF_DEFAULT_GENDER } = require('../src/constants/gender');

const SEED_CONFIG_INVALID = 'SEED_CONFIG_INVALID';

const SeedResult = Object.freeze({
  CREATED: 'CREATED',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EXISTS_WITH_OTHER_ROLE: 'EXISTS_WITH_OTHER_ROLE',
});

// Same rules as signup. Messages never echo the submitted value, so the password cannot leak.
const ownerSeedSchema = z.object({
  SEED_OWNER_EMAIL: emailField,
  SEED_OWNER_PASSWORD: z
    .string({ error: Messages.PASSWORD_REQUIRED })
    .max(72, Messages.PASSWORD_MAX_LENGTH)
    .regex(PASSWORD_REGEX, PASSWORD_POLICY_MESSAGE),
  SEED_OWNER_FULL_NAME: fullNameField,
  SEED_OWNER_PHONE: phoneField(Messages.PHONE_REQUIRED),
});

const parseOwnerConfig = (source) => {
  const result = ownerSeedSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw createAppError(
      400,
      `Invalid owner seed environment variables:\n${issues}`,
      SEED_CONFIG_INVALID,
    );
  }
  const config = result.data;
  return {
    email: config.SEED_OWNER_EMAIL,
    password: config.SEED_OWNER_PASSWORD,
    fullName: config.SEED_OWNER_FULL_NAME,
    phone: config.SEED_OWNER_PHONE,
  };
};

const createOwner = async ({ email, password, fullName, phone }) =>
  createUser({
    id: crypto.randomUUID(),
    fullName,
    email,
    phone,
    gender: STAFF_DEFAULT_GENDER,
    passwordHash: await hashPassword(password),
    role: Role.OWNER,
    status: AccountStatus.ACTIVE,
    mustChangePassword: false,
  });

// Idempotent: an existing user is never modified (password and role stay as they are).
const seedOwner = async (source) => {
  const config = parseOwnerConfig(source);

  const existing = await findByEmail(config.email);
  if (existing) {
    const status =
      existing.role === Role.OWNER ? SeedResult.ALREADY_EXISTS : SeedResult.EXISTS_WITH_OTHER_ROLE;
    return { status, email: config.email, role: existing.role };
  }

  const owner = await createOwner(config);
  return { status: SeedResult.CREATED, email: owner.email, role: owner.role };
};

const describeSeedResult = ({ status, email, role }) => {
  switch (status) {
    case SeedResult.CREATED:
      return `Owner created: ${email}`;
    case SeedResult.ALREADY_EXISTS:
      return `Owner already exists: ${email} (nothing changed)`;
    default:
      return `WARNING: ${email} already exists with role ${role}, not OWNER. Nothing changed; fix the role manually if this user should be the owner.`;
  }
};

module.exports = { seedOwner, describeSeedResult, SeedResult, SEED_CONFIG_INVALID };
