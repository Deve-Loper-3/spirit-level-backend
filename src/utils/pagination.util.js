const toSkipTake = ({ page, limit }) => ({ skip: (page - 1) * limit, take: limit });

const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

// Page envelope of list endpoints that use `pageSize`; `counts` carries extra tab badges.
const buildMeta = ({ page, pageSize, total, counts }) => ({ page, pageSize, total, counts });

module.exports = { toSkipTake, buildPagination, buildMeta };
