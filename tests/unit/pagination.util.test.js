const { toSkipTake, buildPagination } = require('../../src/utils/pagination.util');

describe('pagination.util', () => {
  describe('toSkipTake', () => {
    it.each([
      [
        { page: 1, limit: 20 },
        { skip: 0, take: 20 },
      ],
      [
        { page: 2, limit: 20 },
        { skip: 20, take: 20 },
      ],
      [
        { page: 5, limit: 7 },
        { skip: 28, take: 7 },
      ],
      [
        { page: 3, limit: 100 },
        { skip: 200, take: 100 },
      ],
    ])('maps %j to %j', (input, expected) => {
      expect(toSkipTake(input)).toEqual(expected);
    });
  });

  describe('buildPagination', () => {
    it.each([
      [0, 0],
      [1, 1],
      [20, 1],
      [21, 2],
      [40, 2],
      [41, 3],
    ])('total %i with limit 20 gives %i total pages', (total, totalPages) => {
      expect(buildPagination({ page: 1, limit: 20, total })).toEqual({
        page: 1,
        limit: 20,
        total,
        totalPages,
      });
    });

    it('keeps a page beyond the end as asked', () => {
      expect(buildPagination({ page: 9, limit: 10, total: 5 })).toEqual({
        page: 9,
        limit: 10,
        total: 5,
        totalPages: 1,
      });
    });
  });
});
