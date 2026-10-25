const z = require('zod');
const { Messages } = require('../constants/messages');
const { DEFAULT_PAGE, MAX_PAGE } = require('../constants/pagination');

// Query values arrive as strings, so numbers are coerced.
const pageField = z.coerce
  .number({ error: Messages.PAGE_INVALID })
  .int(Messages.PAGE_INVALID)
  .min(1, Messages.PAGE_INVALID)
  .max(MAX_PAGE, Messages.PAGE_INVALID)
  .default(DEFAULT_PAGE);

// The page size field is named `limit` by some endpoints and `pageSize` by others.
const buildSizeField = ({ message, max, defaultValue }) =>
  z.coerce
    .number({ error: message })
    .int(message)
    .min(1, message)
    .max(max, message)
    .default(defaultValue);

module.exports = { pageField, buildSizeField };
