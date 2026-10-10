jest.mock('../../src/repositories/user.repository', () => ({
  findByEmail: jest.fn(),
  createUser: jest.fn(),
}));
jest.mock('../../src/utils/password.util', () => ({
  ...jest.requireActual('../../src/utils/password.util'),
  hashPassword: jest.fn(),
}));

const {
  seedOwner,
  describeSeedResult,
  SeedResult,
  SEED_CONFIG_INVALID,
} = require('../../prisma/seed-owner');
const { findByEmail, createUser } = require('../../src/repositories/user.repository');
const { hashPassword } = require('../../src/utils/password.util');
const { Role } = require('../../src/constants/roles');
const { AccountStatus } = require('../../src/constants/status');
const { STAFF_DEFAULT_GENDER } = require('../../src/constants/gender');

const PASSWORD = 'SeedSecret123';
const PASSWORD_HASH = '$2b$12$hashed-seed-password';
const validEnv = () => ({
  SEED_OWNER_EMAIL: '  Owner@Test.INVALID ',
  SEED_OWNER_PASSWORD: PASSWORD,
  SEED_OWNER_FULL_NAME: 'First Owner',
  SEED_OWNER_PHONE: '+1 (202) 555-0100',
});

const captureError = async (source) => {
  try {
    await seedOwner(source);
  } catch (err) {
    return err;
  }
  throw new Error('seedOwner did not throw');
};

describe('seed-owner', () => {
  beforeEach(() => {
    findByEmail.mockResolvedValue(null);
    createUser.mockImplementation(async (data) => data);
    hashPassword.mockResolvedValue(PASSWORD_HASH);
  });

  describe('seedOwner - create', () => {
    it('creates an ACTIVE OWNER with the forced defaults and a hashed password', async () => {
      const result = await seedOwner(validEnv());

      expect(findByEmail).toHaveBeenCalledWith('owner@test.invalid');
      expect(hashPassword).toHaveBeenCalledWith(PASSWORD);
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(createUser).toHaveBeenCalledWith({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        fullName: 'First Owner',
        email: 'owner@test.invalid',
        phone: '+12025550100',
        gender: STAFF_DEFAULT_GENDER,
        passwordHash: PASSWORD_HASH,
        role: Role.OWNER,
        status: AccountStatus.ACTIVE,
        mustChangePassword: false,
      });
      expect(result).toEqual({
        status: SeedResult.CREATED,
        email: 'owner@test.invalid',
        role: Role.OWNER,
      });
    });

    it('never stores the plain password', async () => {
      await seedOwner(validEnv());

      expect(JSON.stringify(createUser.mock.calls[0][0])).not.toContain(PASSWORD);
    });
  });

  describe('seedOwner - already exists', () => {
    it('does nothing when the owner already exists', async () => {
      findByEmail.mockResolvedValue({ email: 'owner@test.invalid', role: Role.OWNER });

      const result = await seedOwner(validEnv());

      expect(result.status).toBe(SeedResult.ALREADY_EXISTS);
      expect(createUser).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('warns and changes nothing when the email belongs to a non-owner', async () => {
      findByEmail.mockResolvedValue({ email: 'owner@test.invalid', role: Role.ADMIN });

      const result = await seedOwner(validEnv());

      expect(result).toEqual({
        status: SeedResult.EXISTS_WITH_OTHER_ROLE,
        email: 'owner@test.invalid',
        role: Role.ADMIN,
      });
      expect(createUser).not.toHaveBeenCalled();
      expect(describeSeedResult(result)).toMatch(/WARNING.*ADMIN/);
    });
  });

  describe('seedOwner - invalid environment', () => {
    it('fails listing every missing variable when nothing is set', async () => {
      const err = await captureError({});

      expect(err).toMatchObject({ code: SEED_CONFIG_INVALID, isOperational: true });
      ['EMAIL', 'PASSWORD', 'FULL_NAME', 'PHONE'].forEach((name) =>
        expect(err.message).toContain(`SEED_OWNER_${name}`),
      );
      expect(findByEmail).not.toHaveBeenCalled();
    });

    it.each([
      ['SEED_OWNER_EMAIL', 'not-an-email'],
      ['SEED_OWNER_PASSWORD', 'weakpassword'],
      ['SEED_OWNER_PASSWORD', `Aa1${'x'.repeat(70)}`],
      ['SEED_OWNER_FULL_NAME', 'A'],
      ['SEED_OWNER_PHONE', '12ab'],
    ])('rejects an invalid %s (%s) without touching the DB', async (name, value) => {
      const err = await captureError({ ...validEnv(), [name]: value });

      expect(err.code).toBe(SEED_CONFIG_INVALID);
      expect(err.message).toContain(name);
      expect(createUser).not.toHaveBeenCalled();
    });
  });

  describe('no password leaks', () => {
    it('keeps the password out of errors, results and output', async () => {
      const weak = 'weakpassword';
      const err = await captureError({ ...validEnv(), SEED_OWNER_PASSWORD: weak });
      const result = await seedOwner(validEnv());

      expect(err.message).not.toContain(weak);
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(describeSeedResult(result)).not.toContain(PASSWORD);
    });

    it('writes nothing to the console', async () => {
      const spies = ['log', 'info', 'warn', 'error'].map((m) =>
        jest.spyOn(console, m).mockImplementation(() => {}),
      );

      await seedOwner(validEnv());

      spies.forEach((spy) => {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      });
    });
  });

  describe('describeSeedResult', () => {
    it.each([
      [SeedResult.CREATED, /created/i],
      [SeedResult.ALREADY_EXISTS, /already exists/i],
    ])('describes %s', (status, pattern) => {
      expect(describeSeedResult({ status, email: 'a@b.c', role: Role.OWNER })).toMatch(pattern);
    });
  });
});
