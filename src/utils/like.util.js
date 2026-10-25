// Prisma `contains` does not escape LIKE wildcards, so "%" and "_" typed by a user would
// otherwise match anything. PostgreSQL's default LIKE escape character is the backslash.
const escapeLikePattern = (text) => text.replace(/[\\%_]/g, '\\$&');

module.exports = { escapeLikePattern };
