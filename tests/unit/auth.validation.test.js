const { completeRegistrationSchema } = require('../../src/validators/auth.validation');
const { Relationship } = require('../../src/constants/relationship');
const { Messages } = require('../../src/constants/messages');

describe('completeRegistrationSchema validation', () => {
  const validPayload = () => ({
    registrationId: '123e4567-e89b-12d3-a456-426614174000',
    emergencyContact: {
      name: 'Jane Doe',
      phone: '+1 (202) 555-0199',
      relationship: Relationship.SPOUSE,
    },
    waiverAccepted: true,
  });

  const getIssue = (result, path) =>
    result.error.issues.find((issue) => issue.path.join('.') === path);

  it('validates a complete, valid payload successfully', () => {
    const payload = validPayload();
    const result = completeRegistrationSchema.safeParse(payload);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      registrationId: '123e4567-e89b-12d3-a456-426614174000',
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+12025550199',
        relationship: Relationship.SPOUSE,
      },
      waiverAccepted: true,
    });
  });

  it('strips unknown keys from payload and emergencyContact', () => {
    const payload = {
      ...validPayload(),
      extraTopLevel: 'remove-me',
      emergencyContact: {
        ...validPayload().emergencyContact,
        extraNested: 'remove-me-too',
      },
    };

    const result = completeRegistrationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data.extraTopLevel).toBeUndefined();
    expect(result.data.emergencyContact.extraNested).toBeUndefined();
  });

  it('trims whitespace on emergencyContact.name', () => {
    const payload = validPayload();
    payload.emergencyContact.name = '   John Smith   ';

    const result = completeRegistrationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data.emergencyContact.name).toBe('John Smith');
  });

  it('normalizes phone by stripping spaces, hyphens, and parentheses', () => {
    const payload = validPayload();
    payload.emergencyContact.phone = '+44 (0) 20 7946 0919';

    const result = completeRegistrationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data.emergencyContact.phone).toBe('+4402079460919');
  });

  it('accepts every valid Relationship enum value', () => {
    Object.values(Relationship).forEach((rel) => {
      const payload = validPayload();
      payload.emergencyContact.relationship = rel;
      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.relationship).toBe(rel);
    });
  });

  describe('registrationId validations', () => {
    it('fails when registrationId is missing', () => {
      const payload = validPayload();
      delete payload.registrationId;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'registrationId');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.REGISTRATION_ID_REQUIRED);
    });

    it('fails when registrationId is not a valid UUID', () => {
      const payload = validPayload();
      payload.registrationId = 'not-a-uuid';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'registrationId');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.REGISTRATION_ID_INVALID);
    });
  });

  describe('emergencyContact object validations', () => {
    it('fails when emergencyContact is missing', () => {
      const payload = validPayload();
      delete payload.emergencyContact;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_CONTACT_REQUIRED);
    });

    it('fails when emergencyContact is null', () => {
      const payload = validPayload();
      payload.emergencyContact = null;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_CONTACT_REQUIRED);
    });
  });

  describe('emergencyContact.name validations', () => {
    it('succeeds and normalizes to undefined when emergencyContact.name is missing', () => {
      const payload = validPayload();
      delete payload.emergencyContact.name;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.name).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.name is empty string', () => {
      const payload = validPayload();
      payload.emergencyContact.name = '';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.name).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.name is whitespace string', () => {
      const payload = validPayload();
      payload.emergencyContact.name = '   ';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.name).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.name is null', () => {
      const payload = validPayload();
      payload.emergencyContact.name = null;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.name).toBeUndefined();
    });

    it('fails when emergencyContact.name is shorter than 2 characters', () => {
      const payload = validPayload();
      payload.emergencyContact.name = 'A';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact.name');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_NAME_MIN_LENGTH);
    });

    it('fails when emergencyContact.name exceeds 100 characters', () => {
      const payload = validPayload();
      payload.emergencyContact.name = 'A'.repeat(101);

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact.name');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_NAME_MAX_LENGTH);
    });
  });

  describe('emergencyContact.phone validations', () => {
    it('fails when emergencyContact.phone is missing', () => {
      const payload = validPayload();
      delete payload.emergencyContact.phone;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact.phone');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_PHONE_REQUIRED);
    });

    it('fails when emergencyContact.phone has invalid format', () => {
      const payload = validPayload();
      payload.emergencyContact.phone = '12345';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact.phone');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_PHONE_INVALID);
    });
  });

  describe('emergencyContact.relationship validations', () => {
    it('succeeds and normalizes to undefined when emergencyContact.relationship is missing', () => {
      const payload = validPayload();
      delete payload.emergencyContact.relationship;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.relationship).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.relationship is empty string', () => {
      const payload = validPayload();
      payload.emergencyContact.relationship = '';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.relationship).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.relationship is whitespace string', () => {
      const payload = validPayload();
      payload.emergencyContact.relationship = '   ';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.relationship).toBeUndefined();
    });

    it('succeeds and normalizes to undefined when emergencyContact.relationship is null', () => {
      const payload = validPayload();
      payload.emergencyContact.relationship = null;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.relationship).toBeUndefined();
    });

    it('fails when emergencyContact.relationship is not a valid enum value', () => {
      const payload = validPayload();
      payload.emergencyContact.relationship = 'COWORKER';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'emergencyContact.relationship');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.EMERGENCY_RELATIONSHIP_INVALID);
    });
  });

  describe('emergencyContact phone-only payload', () => {
    it('succeeds with phone only in emergencyContact', () => {
      const payload = validPayload();
      payload.emergencyContact = {
        phone: '+12025550199',
      };

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.emergencyContact.phone).toBe('+12025550199');
      expect(result.data.emergencyContact.name).toBeUndefined();
      expect(result.data.emergencyContact.relationship).toBeUndefined();
    });
  });

  describe('waiverAccepted validations', () => {
    it('fails when waiverAccepted is missing', () => {
      const payload = validPayload();
      delete payload.waiverAccepted;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'waiverAccepted');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.WAIVER_MUST_BE_ACCEPTED);
    });

    it('fails when waiverAccepted is false', () => {
      const payload = validPayload();
      payload.waiverAccepted = false;

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'waiverAccepted');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.WAIVER_MUST_BE_ACCEPTED);
    });

    it('fails when waiverAccepted is a truthy non-boolean value like "true"', () => {
      const payload = validPayload();
      payload.waiverAccepted = 'true';

      const result = completeRegistrationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      const issue = getIssue(result, 'waiverAccepted');
      expect(issue).toBeDefined();
      expect(issue.message).toBe(Messages.WAIVER_MUST_BE_ACCEPTED);
    });
  });
});
