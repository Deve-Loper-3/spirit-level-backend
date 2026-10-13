const z = require('zod');
const {
  validateBody,
  validateParams,
  validateQuery,
  validateByRole,
} = require('../../src/middlewares/validate.middleware');
const { AppErrors } = require('../../src/constants/errors');

const schema = z.object({ n: z.coerce.number() });

describe('validate.middleware', () => {
  it('validateBody replaces req.body with the parsed value', () => {
    const req = { body: { n: '5' } };
    const next = jest.fn();

    validateBody(schema)(req, {}, next);

    expect(req.body).toEqual({ n: 5 });
    expect(next).toHaveBeenCalledWith();
  });

  it('validateParams replaces req.params with the parsed value', () => {
    const req = { params: { n: '7' } };
    const next = jest.fn();

    validateParams(schema)(req, {}, next);

    expect(req.params).toEqual({ n: 7 });
    expect(next).toHaveBeenCalledWith();
  });

  it('validateQuery leaves req.query alone and stores the parsed value on req.validatedQuery', () => {
    const req = { query: { n: '9' } };
    const next = jest.fn();

    validateQuery(schema)(req, {}, next);

    expect(req.query).toEqual({ n: '9' });
    expect(req.validatedQuery).toEqual({ n: 9 });
    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['validateBody', validateBody, 'body'],
    ['validateParams', validateParams, 'params'],
    ['validateQuery', validateQuery, 'query'],
  ])('%s passes the ZodError to next and changes nothing', (_name, factory, key) => {
    const req = { [key]: { n: 'abc' } };
    const next = jest.fn();

    factory(schema)(req, {}, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(z.ZodError);
    expect(req[key]).toEqual({ n: 'abc' });
    expect(req.validatedQuery).toBeUndefined();
  });

  describe('validateByRole', () => {
    const adminValidator = jest.fn((_req, _res, next) => next());
    const coachValidator = jest.fn((_req, _res, next) => next('coach-validator'));
    const middleware = validateByRole(
      new Map([
        ['ADMIN', adminValidator],
        ['COACH', coachValidator],
      ]),
    );

    beforeEach(() => {
      adminValidator.mockClear();
      coachValidator.mockClear();
    });

    it('runs only the validator of the caller role', () => {
      const next = jest.fn();

      middleware({ user: { role: 'ADMIN' } }, {}, next);

      expect(adminValidator).toHaveBeenCalledTimes(1);
      expect(coachValidator).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('passes req, res and next through to that validator', () => {
      const next = jest.fn();
      const req = { user: { role: 'COACH' } };

      middleware(req, {}, next);

      expect(coachValidator).toHaveBeenCalledWith(req, {}, next);
      expect(next).toHaveBeenCalledWith('coach-validator');
    });

    it.each([['MEMBER'], ['STRANGER'], [undefined]])(
      'answers 403 FORBIDDEN for the role %s, which has no validator',
      (role) => {
        const next = jest.fn();

        middleware({ user: { role } }, {}, next);

        expect(next.mock.calls[0][0]).toMatchObject({
          statusCode: 403,
          code: AppErrors.FORBIDDEN.code,
        });
        expect(adminValidator).not.toHaveBeenCalled();
      },
    );

    it('answers 403 when there is no authenticated user', () => {
      const next = jest.fn();

      middleware({}, {}, next);

      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    });
  });
});
