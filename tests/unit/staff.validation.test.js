const { ZodError } = require('zod');
const { createStaffSchema, validateCreateStaff } = require('../../src/validators/staff.validation');
const { Role } = require('../../src/constants/roles');
const { Messages } = require('../../src/constants/messages');

describe('staff.validation - createStaffSchema', () => {
  const validPayload = {
    fullName: 'John Doe',
    email: 'Coach.John@example.com',
    phone: '+1 202-555-1234',
    role: Role.COACH,
  };

  it('successfully parses a valid payload and normalizes email and phone', () => {
    const result = createStaffSchema.parse(validPayload);

    expect(result).toEqual({
      fullName: 'John Doe',
      email: 'coach.john@example.com',
      phone: '+12025551234',
      role: Role.COACH,
    });
  });

  it('trims whitespace from fullName', () => {
    const result = createStaffSchema.parse({
      ...validPayload,
      fullName: '  Alice Smith  ',
    });

    expect(result.fullName).toBe('Alice Smith');
  });

  it.each([Role.MEMBER, Role.COACH, Role.ADMIN, Role.OWNER])('accepts role %s', (role) => {
    const result = createStaffSchema.parse({ ...validPayload, role });
    expect(result.role).toBe(role);
  });

  it.each(['SUPERADMIN', 'USER', '', undefined, null])('rejects invalid role %j', (role) => {
    const result = createStaffSchema.safeParse({ ...validPayload, role });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(Messages.STAFF_ROLE_INVALID);
  });

  describe('fullName validation', () => {
    it('fails when fullName is missing', () => {
      const payload = { ...validPayload };
      delete payload.fullName;
      const result = createStaffSchema.safeParse(payload);

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.FULL_NAME_REQUIRED);
    });

    it('fails when fullName is empty or whitespace', () => {
      const result = createStaffSchema.safeParse({ ...validPayload, fullName: '   ' });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.FULL_NAME_MIN_LENGTH);
    });

    it('fails when fullName is fewer than 2 characters', () => {
      const result = createStaffSchema.safeParse({ ...validPayload, fullName: 'J' });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.FULL_NAME_MIN_LENGTH);
    });

    it('fails when fullName exceeds 100 characters', () => {
      const result = createStaffSchema.safeParse({ ...validPayload, fullName: 'A'.repeat(101) });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.FULL_NAME_MAX_LENGTH);
    });
  });

  describe('email validation', () => {
    it('fails when email is missing', () => {
      const payload = { ...validPayload };
      delete payload.email;
      const result = createStaffSchema.safeParse(payload);

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.EMAIL_REQUIRED);
    });

    it('fails when email is invalid', () => {
      const result = createStaffSchema.safeParse({ ...validPayload, email: 'not-an-email' });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.EMAIL_INVALID);
    });
  });

  describe('phone validation', () => {
    it('fails when phone is missing', () => {
      const payload = { ...validPayload };
      delete payload.phone;
      const result = createStaffSchema.safeParse(payload);

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.PHONE_REQUIRED);
    });

    it('fails when phone format is invalid', () => {
      const result = createStaffSchema.safeParse({ ...validPayload, phone: '123' });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.PHONE_INVALID);
    });
  });

  describe('unknown fields rejection (strict schema)', () => {
    it.each([
      'firstName',
      'lastName',
      'status',
      'id',
      'password',
      'gender',
      'mustChangePassword',
      'unknownField',
    ])('rejects when unknown field %s is present', (field) => {
      const payload = { ...validPayload, [field]: 'arbitrary-value' };
      const result = createStaffSchema.safeParse(payload);

      expect(result.success).toBe(false);
      expect(result.error.issues[0].code).toBe('unrecognized_keys');
    });
  });
});

describe('staff.validation - validateCreateStaff middleware', () => {
  it('calls next() without error and attaches sanitized body on valid input', () => {
    const req = {
      body: {
        fullName: ' Jane Doe ',
        email: 'JANE@example.com',
        phone: '+1 (202) 555-9876',
        role: Role.ADMIN,
      },
    };
    const next = jest.fn();

    validateCreateStaff(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+12025559876',
      role: Role.ADMIN,
    });
  });

  it('calls next(error) with ZodError on invalid input', () => {
    const req = { body: {} };
    const next = jest.fn();

    validateCreateStaff(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });
});
