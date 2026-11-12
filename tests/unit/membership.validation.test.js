const {
  listMembershipsQuerySchema,
  validateListMembershipsQuery,
} = require('../../src/validators/membership.validation');
const { validateMembershipIdParam } = require('../../src/validators/idParam.validation');
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require('../../src/constants/pagination');

const runQuery = (query) => {
  const req = { query };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  validateListMembershipsQuery(req, res, next);
  return { req, res, next, errors: res.json.mock.calls[0]?.[0].errors };
};

describe('validateListMembershipsQuery', () => {
  it('defaults page and limit', () => {
    const { req, next } = runQuery({});

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedQuery).toEqual({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT });
  });

  it('coerces numeric strings', () => {
    const { req } = runQuery({ page: '3', limit: '50' });
    expect(req.validatedQuery).toEqual({ page: 3, limit: 50 });
  });

  it('drops unknown parameters instead of rejecting them', () => {
    const { req, next } = runQuery({ page: '2', foo: 'bar' });

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedQuery).toEqual({ page: 2, limit: DEFAULT_LIMIT });
  });

  it.each([
    ['page', '0'],
    ['page', 'abc'],
    ['page', '1.5'],
    ['limit', '0'],
    ['limit', '101'],
    ['limit', '-1'],
  ])('rejects %s=%s with a 400 on that field', (field, value) => {
    const { res, next, errors } = runQuery({ [field]: value });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(errors.map((error) => error.field)).toEqual([field]);
  });

  it('reports page and limit together when both are bad', () => {
    const { errors } = runQuery({ page: '0', limit: '0' });
    expect(errors.map((error) => error.field).sort()).toEqual(['limit', 'page']);
  });

  it('uses the shared pagination fields only', () => {
    expect(Object.keys(listMembershipsQuerySchema.shape).sort()).toEqual(['limit', 'page']);
  });
});

describe('validateMembershipIdParam', () => {
  const run = (id) => {
    const req = { params: { id } };
    const next = jest.fn();
    validateMembershipIdParam(req, {}, next);
    return { req, next, error: next.mock.calls[0][0] };
  };

  it('accepts a UUID and calls next without an error', () => {
    const { next, error } = run('123e4567-e89b-42d3-a456-426614174000');

    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });

  it('passes a validation error for the id field with the membership message', () => {
    const { error } = run('nope');

    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].path).toEqual(['id']);
    expect(error.issues[0].message).toBe('Membership ID must be a valid UUID');
  });
});
