const z = require('zod');
const { paginationQueryFields } = require('../../src/validators/pagination.validation');
const { Messages } = require('../../src/constants/messages');

const schema = z.object(paginationQueryFields);

describe('paginationQueryFields (shared by every list endpoint)', () => {
  it('defaults to page 1 and limit 20', () => {
    expect(schema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces query strings to numbers', () => {
    expect(schema.parse({ page: '3', limit: '100' })).toEqual({ page: 3, limit: 100 });
  });

  it.each(['0', '101', '-1', '1.5', 'abc'])('rejects limit=%s with the limit message', (limit) => {
    const result = schema.safeParse({ limit });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(Messages.LIMIT_INVALID);
    expect(result.error.issues[0].path).toEqual(['limit']);
  });

  it.each(['0', '100001', 'x'])('rejects page=%s with the page message', (page) => {
    const result = schema.safeParse({ page });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe(Messages.PAGE_INVALID);
  });

  it('ignores the old pageSize name instead of reading it', () => {
    expect(schema.parse({ pageSize: '50' })).toEqual({ page: 1, limit: 20 });
  });
});
