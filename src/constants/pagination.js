const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Keeps `skip` far below the 32-bit integer limit of the database.
const MAX_PAGE = 100000;

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
};
