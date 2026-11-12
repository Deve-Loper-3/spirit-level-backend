const {
  validateUpdatePlanBody,
  validatePlanStatusBody,
} = require('../../src/validators/membershipPlan.validation');
const { methodNotAllowed } = require('../../src/middlewares/methodNotAllowed.middleware');
const { PLAN_NON_EDITABLE_FIELDS } = require('../../src/constants/membershipPlan');

const storedPlan = (overrides = {}) => ({
  id: 'plan-1',
  name: 'Gold Class',
  kind: 'SUBSCRIPTION',
  price: 350,
  billingCycle: 'MONTH',
  creditType: 'CLASS',
  creditsIncluded: 15,
  creditRefill: 'MONTHLY',
  validityValue: 1,
  validityUnit: 'MONTH',
  startsOn: 'PURCHASE_DATE',
  oneTimePurchasePerClient: false,
  visibility: 'PUBLIC',
  status: 'ACTIVE',
  description: null,
  version: 1,
  ...overrides,
});

const run = (validator, { body, plan = storedPlan() }) => {
  const req = { body, plan };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  validator(req, res, next);
  return { req, res, next, errors: res.json.mock.calls[0]?.[0].errors };
};

const fields = (errors) => errors.map((error) => error.field).sort();

describe('validateUpdatePlanBody', () => {
  it('continues with the full validated set of editable fields', () => {
    const { req, next } = run(validateUpdatePlanBody, {
      body: { price: '400', description: ' hi ' },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedBody).toMatchObject({
      name: 'Gold Class',
      price: 400,
      creditType: 'CLASS',
      creditsIncluded: 15,
      description: 'hi',
    });
    expect(req.validatedBody).not.toHaveProperty('status');
    expect(req.validatedBody).not.toHaveProperty('version');
  });

  it.each(PLAN_NON_EDITABLE_FIELDS.filter((field) => field !== 'status'))(
    'rejects %s with 400',
    (field) => {
      const { res, next, errors } = run(validateUpdatePlanBody, { body: { [field]: 'x' } });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(errors).toEqual([{ field, message: 'This field cannot be edited' }]);
    },
  );

  it('rejects status and points to the status endpoint', () => {
    const { res, errors } = run(validateUpdatePlanBody, { body: { status: 'archived' } });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(errors).toEqual([
      { field: 'status', message: expect.stringContaining('PATCH /api/v1/plans/:id/status') },
    ]);
  });

  it('rejects unknown fields and an empty or missing body', () => {
    expect(run(validateUpdatePlanBody, { body: { colour: 'red' } }).errors).toEqual([
      { field: 'colour', message: 'Unknown field' },
    ]);
    expect(run(validateUpdatePlanBody, { body: {} }).res.status).toHaveBeenCalledWith(400);
    expect(run(validateUpdatePlanBody, { body: undefined }).res.status).toHaveBeenCalledWith(400);
  });

  describe('joiningFee', () => {
    it('is editable: a valid number goes into the validated set', () => {
      const { req, next } = run(validateUpdatePlanBody, { body: { joiningFee: '75.5' } });

      expect(next).toHaveBeenCalledWith();
      expect(req.validatedBody.joiningFee).toBe(75.5);
    });

    it('keeps the stored fee when it is not sent', () => {
      const { req } = run(validateUpdatePlanBody, {
        body: { price: 360 },
        plan: storedPlan({ joiningFee: { valueOf: () => '40.00' } }),
      });

      expect(req.validatedBody.joiningFee).toBe(40);
    });

    it.each([
      ['negative', -5],
      ['null', null],
      ['blank', ''],
      ['not a number', 'abc'],
    ])('rejects a %s fee with a joiningFee error', (_label, joiningFee) => {
      const { res, next, errors } = run(validateUpdatePlanBody, { body: { joiningFee } });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(fields(errors)).toEqual(['joiningFee']);
    });
  });

  it('reports non-editable fields before it validates the merged result', () => {
    const { errors } = run(validateUpdatePlanBody, { body: { id: 'x', price: -5 } });
    expect(fields(errors)).toEqual(['id']);
  });

  it('validates the merged result: a lone creditType change to time needs the time rules', () => {
    const { res, errors } = run(validateUpdatePlanBody, { body: { creditType: 'time' } });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(fields(errors)).toEqual(['creditRefill', 'creditsIncluded']);
  });

  it('accepts the switch to time when the time rules are met', () => {
    const { req, next } = run(validateUpdatePlanBody, {
      body: { creditType: 'time', creditsIncluded: 0, creditRefill: null },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedBody).toMatchObject({
      creditType: 'TIME',
      creditsIncluded: 0,
      creditRefill: null,
    });
  });

  it('applies the create rules to the merged result: recurring billing needs a subscription', () => {
    const { errors } = run(validateUpdatePlanBody, { body: { kind: 'trial' } });
    expect(errors).toContainEqual({
      field: 'billingCycle',
      message: 'Only a membership renews monthly.',
    });
  });

  it('reports a negative price, and a monthly refill on a non-monthly cycle', () => {
    const { errors } = run(validateUpdatePlanBody, {
      body: { price: -1, billingCycle: 'year' },
    });
    expect(fields(errors)).toEqual(['creditRefill', 'price']);
  });

  it('reports every failing field together', () => {
    const { errors } = run(validateUpdatePlanBody, {
      body: { name: 'x', price: 'abc', visibility: 'secret' },
    });
    expect(fields(errors)).toEqual(['name', 'price', 'visibility']);
  });
});

describe('validatePlanStatusBody', () => {
  it('reads the status case-insensitively and the optional reason', () => {
    const { req, next } = run(validatePlanStatusBody, {
      body: { status: ' Archived ', reason: '  closing  ' },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedBody).toEqual({ status: 'ARCHIVED', reason: 'closing' });
  });

  it('works without a reason, and a blank reason counts as none', () => {
    expect(run(validatePlanStatusBody, { body: { status: 'active' } }).req.validatedBody).toEqual({
      status: 'ACTIVE',
    });
    expect(
      run(validatePlanStatusBody, { body: { status: 'active', reason: '  ' } }).req.validatedBody
        .reason,
    ).toBeUndefined();
  });

  it('accepts a reason of exactly 200 characters and rejects 201', () => {
    expect(
      run(validatePlanStatusBody, { body: { status: 'active', reason: 'a'.repeat(200) } }).next,
    ).toHaveBeenCalledWith();
    const { res, errors } = run(validatePlanStatusBody, {
      body: { status: 'active', reason: 'a'.repeat(201) },
    });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fields(errors)).toEqual(['reason']);
  });

  it.each([
    ['missing', {}],
    ['unknown', { status: 'deleted' }],
    ['a number', { status: 1 }],
  ])('rejects a status that is %s', (_label, body) => {
    const { res, errors } = run(validatePlanStatusBody, { body });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fields(errors)).toEqual(['status']);
  });

  it('rejects other fields and a missing body', () => {
    expect(
      run(validatePlanStatusBody, { body: { status: 'active', price: 1 } }).res.status,
    ).toHaveBeenCalledWith(400);
    expect(run(validatePlanStatusBody, { body: undefined }).res.status).toHaveBeenCalledWith(400);
  });
});

describe('methodNotAllowed', () => {
  it('sets Allow and passes a 405', () => {
    const res = { set: jest.fn() };
    const next = jest.fn();

    const [limiter, handler] = methodNotAllowed(['GET', 'PATCH']);
    expect(typeof limiter.resetKey).toBe('function');
    handler({}, res, next);

    expect(res.set).toHaveBeenCalledWith('Allow', 'GET, PATCH');
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 405, code: 'METHOD_NOT_ALLOWED' });
  });
});
