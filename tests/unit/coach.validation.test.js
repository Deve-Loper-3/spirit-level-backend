// The trusted-image-URL check derives the allowed host from this token.
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_fakesecret';

const { ZodError } = require('zod');
const {
  createCoachSchema,
  listCoachesQuerySchema,
  publicListCoachesQuerySchema,
  validateListCoachesQuery,
  validateUpdateCoach,
  coachIdParamSchema,
  buildUpdateCoachSchema,
  coachStatusBodySchema,
  validateCreateCoach,
} = require('../../src/validators/coach.validation');
const { Messages } = require('../../src/constants/messages');
const { ADMIN_COACH_UPDATE_FIELDS, UPDATE_FIELDS_BY_ROLE } = require('../../src/constants/coach');

describe('coach.validation - createCoachSchema', () => {
  const validPayload = {
    fullName: 'Casey Coach',
    email: 'Casey.Coach@example.com',
    phone: '+1 202-555-1234',
    coachType: 'SALARIED',
  };

  const firstIssue = (payload) => createCoachSchema.safeParse(payload).error.issues[0];

  it('parses a minimal payload and normalizes email and phone', () => {
    expect(createCoachSchema.parse(validPayload)).toEqual({
      fullName: 'Casey Coach',
      email: 'casey.coach@example.com',
      phone: '+12025551234',
      coachType: 'SALARIED',
    });
  });

  it('accepts bio, status and a trusted profileImageUrl, and trims the bio', () => {
    const profileImageUrl = 'https://teststore.public.blob.vercel-storage.com/profile-images/a.jpg';

    const result = createCoachSchema.parse({
      ...validPayload,
      coachType: 'FREELANCE',
      bio: '  Strong coach  ',
      status: 'INACTIVE',
      profileImageUrl,
    });

    expect(result).toMatchObject({
      coachType: 'FREELANCE',
      bio: 'Strong coach',
      status: 'INACTIVE',
      profileImageUrl,
    });
  });

  it.each(['fullName', 'email', 'phone', 'coachType'])('requires %s', (field) => {
    const payload = { ...validPayload };
    delete payload[field];

    const result = createCoachSchema.safeParse(payload);

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual([field]);
  });

  it('keeps phone required with the shared message', () => {
    const payload = { ...validPayload };
    delete payload.phone;

    expect(firstIssue(payload).message).toBe(Messages.PHONE_REQUIRED);
  });

  it.each(['COACH', 'salaried', '', null])('rejects coachType %j', (coachType) => {
    expect(firstIssue({ ...validPayload, coachType }).message).toBe(Messages.COACH_TYPE_INVALID);
  });

  it.each(['PENDING', 'DISABLED', 'active', ''])('rejects status %j', (status) => {
    expect(firstIssue({ ...validPayload, status }).message).toBe(Messages.COACH_STATUS_INVALID);
  });

  it('accepts a bio of exactly 1000 characters and rejects 1001', () => {
    expect(createCoachSchema.safeParse({ ...validPayload, bio: 'a'.repeat(1000) }).success).toBe(
      true,
    );
    expect(firstIssue({ ...validPayload, bio: 'a'.repeat(1001) }).message).toBe(
      Messages.COACH_BIO_MAX_LENGTH,
    );
  });

  it('rejects a non-string bio', () => {
    expect(firstIssue({ ...validPayload, bio: 5 }).message).toBe(Messages.COACH_BIO_INVALID);
  });

  it('rejects an untrusted profileImageUrl', () => {
    const issue = firstIssue({ ...validPayload, profileImageUrl: 'https://evil.example/a.jpg' });

    expect(issue.message).toBe(Messages.IMAGE_URL_INVALID);
  });

  it.each(['role', 'firstName', 'password', 'userId', 'salary', 'qualifications', 'unknown'])(
    'rejects the unknown field %s',
    (field) => {
      expect(firstIssue({ ...validPayload, [field]: 'x' }).code).toBe('unrecognized_keys');
    },
  );
});

describe('coach.validation - validateCreateCoach', () => {
  it('attaches the sanitized body and calls next()', () => {
    const req = {
      body: {
        fullName: ' Jo Coach ',
        email: 'JO@example.com',
        phone: '+12025559876',
        coachType: 'FREELANCE',
      },
    };
    const next = jest.fn();

    validateCreateCoach(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body.email).toBe('jo@example.com');
  });

  it('calls next(ZodError) on invalid input', () => {
    const next = jest.fn();

    validateCreateCoach({ body: {} }, {}, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });
});

describe('coach.validation - listCoachesQuerySchema', () => {
  const firstIssue = (query) => listCoachesQuerySchema.safeParse(query).error.issues[0];

  it('applies the defaults page 1 and limit 20', () => {
    expect(listCoachesQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces string numbers and keeps the filters', () => {
    expect(
      listCoachesQuerySchema.parse({
        page: '3',
        limit: '50',
        search: '  ann  ',
        status: 'ACTIVE',
        coachType: 'FREELANCE',
      }),
    ).toEqual({ page: 3, limit: 50, search: 'ann', status: 'ACTIVE', coachType: 'FREELANCE' });
  });

  it('treats a blank search as no search', () => {
    expect(listCoachesQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
  });

  it('accepts limit 100 and page 100000 and rejects the next value', () => {
    expect(listCoachesQuerySchema.safeParse({ limit: '100', page: '100000' }).success).toBe(true);
    expect(firstIssue({ limit: '101' }).message).toBe(Messages.LIMIT_INVALID);
    expect(firstIssue({ page: '100001' }).message).toBe(Messages.PAGE_INVALID);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects page %j', (page) => {
    expect(firstIssue({ page }).message).toBe(Messages.PAGE_INVALID);
  });

  it.each(['0', '-5', '2.5', 'abc', ''])('rejects limit %j', (limit) => {
    expect(firstIssue({ limit }).message).toBe(Messages.LIMIT_INVALID);
  });

  it('rejects repeated parameters', () => {
    expect(firstIssue({ page: ['1', '2'] }).message).toBe(Messages.PAGE_INVALID);
    expect(firstIssue({ search: ['a', 'b'] }).message).toBe(Messages.COACH_SEARCH_INVALID);
  });

  it('rejects a search longer than 100 characters', () => {
    expect(firstIssue({ search: 'a'.repeat(101) }).message).toBe(Messages.COACH_SEARCH_INVALID);
  });

  it.each(['INACTIVEX', 'active', 'DISABLED'])('rejects status %j', (status) => {
    expect(firstIssue({ status }).message).toBe(Messages.COACH_STATUS_INVALID);
  });

  it.each(['CONTRACTOR', 'salaried'])('rejects coachType %j', (coachType) => {
    expect(firstIssue({ coachType }).message).toBe(Messages.COACH_TYPE_INVALID);
  });

  it('rejects unknown query keys', () => {
    expect(firstIssue({ sort: 'name' }).code).toBe('unrecognized_keys');
  });
});

describe('coach.validation - coachIdParamSchema', () => {
  it('accepts a UUID', () => {
    const coachId = '123e4567-e89b-42d3-a456-426614174000';

    expect(coachIdParamSchema.parse({ coachId })).toEqual({ coachId });
  });

  it.each(['abc', '123', '', '123e4567-e89b-42d3-a456-42661417400'])(
    'rejects the malformed id %j',
    (coachId) => {
      const result = coachIdParamSchema.safeParse({ coachId });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe(Messages.COACH_ID_INVALID);
    },
  );
});

describe('coach.validation - buildUpdateCoachSchema', () => {
  const adminSchema = buildUpdateCoachSchema(ADMIN_COACH_UPDATE_FIELDS);
  const selfSchema = buildUpdateCoachSchema(['fullName', 'phone', 'profileImageUrl', 'bio']);
  const issueOf = (schema, body) => schema.safeParse(body).error.issues[0];
  const IMAGE = 'https://teststore.public.blob.vercel-storage.com/profile-images/a.jpg';

  it('accepts a single field (partial update)', () => {
    expect(adminSchema.parse({ bio: 'Only bio' })).toEqual({ bio: 'Only bio' });
    expect(adminSchema.parse({ coachType: 'FREELANCE' })).toEqual({ coachType: 'FREELANCE' });
  });

  it('accepts all six fields and normalizes email, phone and bio', () => {
    expect(
      adminSchema.parse({
        fullName: '  New Name  ',
        email: 'New@Example.com',
        phone: '+1 202-555-1234',
        profileImageUrl: IMAGE,
        bio: '  Bio  ',
        coachType: 'SALARIED',
      }),
    ).toEqual({
      fullName: 'New Name',
      email: 'new@example.com',
      phone: '+12025551234',
      profileImageUrl: IMAGE,
      bio: 'Bio',
      coachType: 'SALARIED',
    });
  });

  it('accepts null for bio and profileImageUrl to clear them', () => {
    expect(adminSchema.parse({ bio: null, profileImageUrl: null })).toEqual({
      bio: null,
      profileImageUrl: null,
    });
  });

  it('does not accept null for phone, fullName, email or coachType', () => {
    for (const field of ['phone', 'fullName', 'email', 'coachType']) {
      expect(adminSchema.safeParse({ [field]: null }).success).toBe(false);
    }
  });

  it('rejects an empty body with COACH_UPDATE_EMPTY', () => {
    expect(issueOf(adminSchema, {}).message).toBe(Messages.COACH_UPDATE_EMPTY);
  });

  it('rejects status in the body (it has its own route)', () => {
    expect(issueOf(adminSchema, { status: 'INACTIVE' }).code).toBe('unrecognized_keys');
    expect(issueOf(adminSchema, { bio: 'x', status: 'ACTIVE' }).code).toBe('unrecognized_keys');
  });

  it.each(['firstName', 'lastName', 'role', 'password', 'userId', 'id', 'salary', 'unknown'])(
    'rejects the unknown field %s',
    (field) => {
      expect(issueOf(adminSchema, { bio: 'x', [field]: 'v' }).code).toBe('unrecognized_keys');
    },
  );

  it('applies the field rules', () => {
    expect(issueOf(adminSchema, { email: 'nope' }).message).toBe(Messages.EMAIL_INVALID);
    expect(issueOf(adminSchema, { phone: '12' }).message).toBe(Messages.PHONE_INVALID);
    expect(issueOf(adminSchema, { fullName: 'A' }).message).toBe(Messages.FULL_NAME_MIN_LENGTH);
    expect(issueOf(adminSchema, { coachType: 'CONTRACTOR' }).message).toBe(
      Messages.COACH_TYPE_INVALID,
    );
    expect(issueOf(adminSchema, { bio: 'a'.repeat(1001) }).message).toBe(
      Messages.COACH_BIO_MAX_LENGTH,
    );
    expect(issueOf(adminSchema, { profileImageUrl: 'https://evil.test/a.jpg' }).message).toBe(
      Messages.IMAGE_URL_INVALID,
    );
  });

  it('limits the accepted keys to allowedFields (coach self-edit list)', () => {
    expect(selfSchema.parse({ fullName: 'Self Edit', bio: null })).toEqual({
      fullName: 'Self Edit',
      bio: null,
    });
    expect(issueOf(selfSchema, { coachType: 'FREELANCE' }).code).toBe('unrecognized_keys');
    expect(issueOf(selfSchema, { email: 'a@example.com' }).code).toBe('unrecognized_keys');
  });
});

describe('coach.validation - coachStatusBodySchema', () => {
  it.each(['ACTIVE', 'INACTIVE'])('accepts %s', (status) => {
    expect(coachStatusBodySchema.parse({ status })).toEqual({ status });
  });

  it.each([
    [{}],
    [{ status: 'DISABLED' }],
    [{ status: 'active' }],
    [{ status: null }],
    [{ status: '' }],
  ])('rejects %j with COACH_STATUS_INVALID', (body) => {
    expect(coachStatusBodySchema.safeParse(body).error.issues[0].message).toBe(
      Messages.COACH_STATUS_INVALID,
    );
  });

  it('rejects any other key', () => {
    const result = coachStatusBodySchema.safeParse({ status: 'ACTIVE', bio: 'x' });

    expect(result.error.issues[0].code).toBe('unrecognized_keys');
  });
});

describe('coach.validation - publicListCoachesQuerySchema', () => {
  const issue = (query) => publicListCoachesQuerySchema.safeParse(query).error.issues[0];

  it('accepts page, limit and search with the same defaults', () => {
    expect(publicListCoachesQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(publicListCoachesQuerySchema.parse({ page: '2', limit: '5', search: ' ann ' })).toEqual({
      page: 2,
      limit: 5,
      search: 'ann',
    });
  });

  it.each([
    ['status', 'ACTIVE'],
    ['coachType', 'FREELANCE'],
    ['sort', 'name'],
  ])('rejects the %s parameter', (key, value) => {
    expect(issue({ [key]: value }).code).toBe('unrecognized_keys');
  });

  it('keeps the page and limit bounds', () => {
    expect(issue({ limit: '101' }).message).toBe(Messages.LIMIT_INVALID);
    expect(issue({ page: '0' }).message).toBe(Messages.PAGE_INVALID);
  });
});

describe('coach.validation - role dispatch', () => {
  const run = (middleware, req) => {
    const next = jest.fn();
    middleware(req, {}, next);
    return next.mock.calls[0][0];
  };

  describe('validateListCoachesQuery', () => {
    it.each(['ADMIN', 'OWNER'])('lets %s use the status and coachType filters', (role) => {
      const req = { user: { role }, query: { status: 'INACTIVE', coachType: 'FREELANCE' } };

      expect(run(validateListCoachesQuery, req)).toBeUndefined();
      expect(req.validatedQuery).toEqual({
        page: 1,
        limit: 20,
        status: 'INACTIVE',
        coachType: 'FREELANCE',
      });
    });

    it.each(['COACH', 'MEMBER'])('rejects the status filter for %s with a ZodError', (role) => {
      const error = run(validateListCoachesQuery, { user: { role }, query: { status: 'ACTIVE' } });

      expect(error).toBeInstanceOf(ZodError);
    });

    it.each(['COACH', 'MEMBER'])('rejects the coachType filter for %s', (role) => {
      const error = run(validateListCoachesQuery, {
        user: { role },
        query: { coachType: 'SALARIED' },
      });

      expect(error).toBeInstanceOf(ZodError);
    });

    it.each(['COACH', 'MEMBER'])('accepts paging and search for %s', (role) => {
      const req = { user: { role }, query: { search: 'ann', page: '2' } };

      expect(run(validateListCoachesQuery, req)).toBeUndefined();
      expect(req.validatedQuery).toEqual({ page: 2, limit: 20, search: 'ann' });
    });

    it('answers 403 for an unknown role', () => {
      const error = run(validateListCoachesQuery, { user: { role: 'STRANGER' }, query: {} });

      expect(error).toMatchObject({ statusCode: 403 });
    });
  });

  describe('validateUpdateCoach(UPDATE_FIELDS_BY_ROLE)', () => {
    const middleware = validateUpdateCoach(UPDATE_FIELDS_BY_ROLE);

    it.each(['ADMIN', 'OWNER'])('lets %s change email and coachType', (role) => {
      const req = { user: { role }, body: { email: 'A@Example.com', coachType: 'FREELANCE' } };

      expect(run(middleware, req)).toBeUndefined();
      expect(req.body).toEqual({ email: 'a@example.com', coachType: 'FREELANCE' });
    });

    it.each([[{ email: 'a@example.com' }], [{ coachType: 'FREELANCE' }], [{ status: 'INACTIVE' }]])(
      'rejects %j in a COACH body',
      (body) => {
        expect(run(middleware, { user: { role: 'COACH' }, body })).toBeInstanceOf(ZodError);
      },
    );

    it('lets a COACH change the four self-edit fields', () => {
      const req = {
        user: { role: 'COACH' },
        body: { fullName: ' Me ', phone: '+1 202-555-1234', bio: null, profileImageUrl: null },
      };

      expect(run(middleware, req)).toBeUndefined();
      expect(req.body).toEqual({
        fullName: 'Me',
        phone: '+12025551234',
        bio: null,
        profileImageUrl: null,
      });
    });

    it('rejects an empty COACH body', () => {
      expect(run(middleware, { user: { role: 'COACH' }, body: {} })).toBeInstanceOf(ZodError);
    });

    it.each(['MEMBER', 'STRANGER'])('answers 403 for %s', (role) => {
      expect(run(middleware, { user: { role }, body: { bio: 'x' } })).toMatchObject({
        statusCode: 403,
      });
    });
  });
});
