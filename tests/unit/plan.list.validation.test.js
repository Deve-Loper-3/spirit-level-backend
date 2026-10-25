const {
  listPlansQuerySchema,
  validateListPlansQuery,
} = require('../../src/validators/membershipPlan.validation');

const parse = (query) => listPlansQuerySchema.safeParse(query);
const fieldsOf = (result) => result.error.issues.map((issue) => issue.path.join('.'));

describe('listPlansQuerySchema', () => {
  it('applies the defaults: page 1, pageSize 20, sort by name', () => {
    expect(parse({}).data).toEqual({
      page: 1,
      pageSize: 20,
      sort: { field: 'name', direction: 'asc' },
    });
  });

  it('turns filters into database values', () => {
    const { data } = parse({
      section: 'Online_Coaching',
      kind: 'credit_pack',
      creditType: 'Time',
      visibility: 'HIDDEN',
      q: '  nutrition ',
      sort: '-price',
      page: '2',
      pageSize: '5',
    });
    expect(data).toEqual({
      section: 'online_coaching',
      kind: 'CREDIT_PACK',
      creditType: 'TIME',
      visibility: 'HIDDEN',
      q: 'nutrition',
      sort: { field: 'price', direction: 'desc' },
      page: 2,
      pageSize: 5,
    });
  });

  it('reads status as a comma list, de-duplicated, and as a repeated param', () => {
    expect(parse({ status: 'Active, archived,active' }).data.status).toEqual([
      'ACTIVE',
      'ARCHIVED',
    ]);
    expect(parse({ status: ['inactive', 'archived'] }).data.status).toEqual([
      'INACTIVE',
      'ARCHIVED',
    ]);
  });

  it('treats blank filters as not given', () => {
    const { data } = parse({ section: '', kind: ' ', status: '', q: '   ' });
    expect(data.section).toBeUndefined();
    expect(data.kind).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.q).toBeUndefined();
  });

  it('drops unknown params instead of rejecting them', () => {
    const result = parse({ foo: 'bar', sections: 'online_coaching', platform: 'android' });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('foo');
    expect(result.data).not.toHaveProperty('sections');
  });

  it('reports every bad value together', () => {
    const result = parse({
      section: 'x',
      kind: 'y',
      creditType: 'z',
      visibility: 'w',
      status: 'active,bogus',
      sort: 'email',
      page: '0',
      pageSize: '101',
      q: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
    expect(fieldsOf(result).sort()).toEqual(
      [
        'section',
        'kind',
        'creditType',
        'visibility',
        'status',
        'sort',
        'page',
        'pageSize',
        'q',
      ].sort(),
    );
  });

  it('rejects a repeated single-value filter', () => {
    expect(fieldsOf(parse({ kind: ['trial', 'subscription'] }))).toEqual(['kind']);
  });
});

describe('validateListPlansQuery', () => {
  const run = (query) => {
    const req = { query };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    validateListPlansQuery(req, res, next);
    return { req, res, next };
  };

  it('stores the parsed query on req.validatedQuery and continues', () => {
    const { req, next } = run({ section: 'class_membership' });
    expect(next).toHaveBeenCalledWith();
    expect(req.validatedQuery.section).toBe('class_membership');
  });

  it('answers 422 with every failing field', () => {
    const { res, next } = run({ section: 'x', pageSize: '0' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.map((e) => e.field).sort()).toEqual(['pageSize', 'section']);
  });
});
