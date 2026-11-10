const { parseSort } = require('../../src/utils/sort.util');
const { buildPagination } = require('../../src/utils/pagination.util');
const { escapeLikePattern } = require('../../src/utils/like.util');

const ALLOWED = ['name', 'price', 'createdAt'];

describe('parseSort', () => {
  it('reads a plain field as ascending', () => {
    expect(parseSort('price', ALLOWED, 'name')).toEqual({ field: 'price', direction: 'asc' });
  });

  it('reads a leading minus as descending', () => {
    expect(parseSort('-price', ALLOWED, 'name')).toEqual({ field: 'price', direction: 'desc' });
    expect(parseSort('-createdAt', ALLOWED, 'name')).toEqual({
      field: 'createdAt',
      direction: 'desc',
    });
  });

  it('falls back to the default when nothing is given', () => {
    expect(parseSort(undefined, ALLOWED, 'name')).toEqual({ field: 'name', direction: 'asc' });
    expect(parseSort('', ALLOWED, '-price')).toEqual({ field: 'price', direction: 'desc' });
  });

  it('returns null for a field that is not allowed', () => {
    expect(parseSort('email', ALLOWED, 'name')).toBeNull();
    expect(parseSort('-', ALLOWED, 'name')).toBeNull();
    expect(parseSort('Price', ALLOWED, 'name')).toBeNull();
  });
});

describe('buildPagination', () => {
  it('returns the page envelope with the page count', () => {
    expect(buildPagination({ page: 2, limit: 10, total: 61 })).toEqual({
      page: 2,
      limit: 10,
      total: 61,
      totalPages: 7,
    });
  });

  it('reports 0 pages for an empty result', () => {
    expect(buildPagination({ page: 1, limit: 20, total: 0 }).totalPages).toBe(0);
  });
});

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the backslash', () => {
    expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
