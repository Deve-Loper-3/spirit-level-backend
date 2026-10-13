const toSkipTake = ({ page, limit }) => ({ skip: (page - 1) * limit, take: limit });

const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

module.exports = { toSkipTake, buildPagination };
