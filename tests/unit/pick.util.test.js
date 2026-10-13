const { pick } = require('../../src/utils/pick.util');

describe('pick.util', () => {
  it('copies only the listed keys that exist', () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c', 'missing'])).toEqual({ a: 1, c: 3 });
  });

  it('keeps null and falsy values', () => {
    expect(pick({ a: null, b: 0, c: '' }, ['a', 'b', 'c'])).toEqual({ a: null, b: 0, c: '' });
  });

  it('returns an empty object for no keys', () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });

  it('does not pick inherited keys', () => {
    expect(pick({ a: 1 }, ['toString', 'constructor'])).toEqual({});
  });
});
