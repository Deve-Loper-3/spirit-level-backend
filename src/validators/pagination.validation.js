const z = require('zod');
const { Messages } = require('../constants/messages');
const { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE } = require('../constants/pagination');

// Query values arrive as strings, so numbers are coerced.
const pageField = z.coerce
  .number({ error: Messages.PAGE_INVALID })
  .int(Messages.PAGE_INVALID)
  .min(1, Messages.PAGE_INVALID)
  .max(MAX_PAGE, Messages.PAGE_INVALID)
  .default(DEFAULT_PAGE);

const limitField = z.coerce
  .number({ error: Messages.LIMIT_INVALID })
  .int(Messages.LIMIT_INVALID)
  .min(1, Messages.LIMIT_INVALID)
  .max(MAX_LIMIT, Messages.LIMIT_INVALID)
  .default(DEFAULT_LIMIT);

// The one set of paging query params every list endpoint accepts: ?page=1&limit=20
const paginationQueryFields = { page: pageField, limit: limitField };

module.exports = { pageField, limitField, paginationQueryFields };
