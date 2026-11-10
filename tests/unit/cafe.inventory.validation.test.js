const {
  updateItemStockSchema,
  listInventoryQuerySchema,
  validateUpdateItemStock,
  validateListInventoryQuery,
} = require('../../src/validators/cafe.validation');
const { Messages } = require('../../src/constants/messages');

describe('Cafe inventory validation (SLAPP-79/81 foundations)', () => {
  describe('updateItemStockSchema', () => {
    it.each([0, 1, 14, 15, 16])('accepts quantity %i without coercion', (quantity) => {
      expect(updateItemStockSchema.parse({ quantity })).toEqual({ quantity });
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['negative', -1],
      ['fractional', 1.5],
      ['numeric string', '15'],
      ['empty string', ''],
      ['non-numeric string', 'abc'],
      ['boolean', false],
      ['array', [15]],
      ['object', {}],
      ['NaN', NaN],
      ['infinite', Infinity],
      ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects a %s quantity on the quantity field', (_label, quantity) => {
      const result = updateItemStockSchema.safeParse({ quantity });

      expect(result.success).toBe(false);
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['quantity'], message: Messages.ITEM_STOCK_INVALID }),
      ]);
    });
  });

  describe('listInventoryQuerySchema', () => {
    it('uses the existing catalogue pagination defaults with no implicit status filter', () => {
      expect(listInventoryQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    });

    it.each(['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK'])(
      'accepts the approved uppercase status %s',
      (status) => {
        expect(listInventoryQuerySchema.parse({ status }).status).toBe(status);
      },
    );

    it('parses pagination, trims search, validates categoryId and strips unknown filters', () => {
      const categoryId = '7b0c3a5e-2f0d-4f65-9a7f-1d3a9a0f2c11';

      expect(
        listInventoryQuerySchema.parse({
          page: '2',
          limit: '100',
          search: '  Protein  ',
          categoryId,
          status: 'LOW_STOCK',
          isTracked: 'false',
          visibility: 'public',
        }),
      ).toEqual({ page: 2, limit: 100, search: 'Protein', categoryId, status: 'LOW_STOCK' });
    });

    it('accepts search at the 100-character boundary and a blank search', () => {
      expect(listInventoryQuerySchema.parse({ search: 'a'.repeat(100) }).search).toHaveLength(100);
      expect(listInventoryQuerySchema.parse({ search: '   ' }).search).toBe('');
    });

    it.each([
      ['page', '0'],
      ['page', '-1'],
      ['page', '1.5'],
      ['page', 'abc'],
      ['page', '100001'],
      ['limit', '0'],
      ['limit', '-1'],
      ['limit', '1.5'],
      ['limit', 'abc'],
      ['limit', '101'],
      ['categoryId', 'not-a-uuid'],
      ['categoryId', ''],
      ['search', 'a'.repeat(101)],
      ['search', ['Protein']],
      ['status', 'low_stock'],
      ['status', 'AVERAGE'],
      ['status', ''],
      ['status', ['LOW_STOCK', 'IN_STOCK']],
    ])('rejects an invalid %s (%j)', (field, value) => {
      const result = listInventoryQuerySchema.safeParse({ [field]: value });

      expect(result.success).toBe(false);
      expect(result.error.issues).toEqual([expect.objectContaining({ path: [field] })]);
    });
  });

  describe('validation middleware', () => {
    let res;
    let next;

    beforeEach(() => {
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
    });

    it('stores the validated stock body and strips fields outside this operation', () => {
      const body = { quantity: 15, availability: 'available', unitCost: 5, delta: 1 };
      const req = { body };

      validateUpdateItemStock(req, res, next);

      expect(req.validatedBody).toEqual({ quantity: 15 });
      expect(req.body).toBe(body);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}])('returns 400 for an absent quantity in body %j', (body) => {
      const req = { body };

      validateUpdateItemStock(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: Messages.VALIDATION_FAILED,
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'quantity', message: Messages.ITEM_STOCK_INVALID }],
      });
      expect(req).not.toHaveProperty('validatedBody');
      expect(next).not.toHaveBeenCalled();
    });

    it('stores parsed query values separately from the read-only Express query', () => {
      const query = { page: '2', limit: '10', search: '  Gel  ', status: 'OUT_OF_STOCK' };
      const req = {};
      Object.defineProperty(req, 'query', { get: () => query });

      validateListInventoryQuery(req, res, next);

      expect(req.validatedQuery).toEqual({
        page: 2,
        limit: 10,
        search: 'Gel',
        status: 'OUT_OF_STOCK',
      });
      expect(req.query).toBe(query);
      expect(query.page).toBe('2');
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('defaults a missing inventory query', () => {
      const req = {};

      validateListInventoryQuery(req, res, next);

      expect(req.validatedQuery).toEqual({ page: 1, limit: 20 });
      expect(next).toHaveBeenCalledWith();
    });

    it('returns every invalid query field in the existing 400 envelope', () => {
      const req = {
        query: {
          page: '0',
          limit: '101',
          categoryId: 'bad',
          search: 'a'.repeat(101),
          status: 'bad',
        },
      };

      validateListInventoryQuery(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: Messages.VALIDATION_FAILED,
        code: 'VALIDATION_ERROR',
        errors: expect.any(Array),
      });
      const { errors } = res.json.mock.calls[0][0];
      expect(errors.map((error) => error.field).sort()).toEqual([
        'categoryId',
        'limit',
        'page',
        'search',
        'status',
      ]);
      expect(errors).toContainEqual({
        field: 'status',
        message: Messages.ITEM_STOCK_STATUS_INVALID,
      });
      expect(req).not.toHaveProperty('validatedQuery');
      expect(next).not.toHaveBeenCalled();
    });
  });
});
