const { ORDER_ADMIN_ROLES } = require('../constants/cafeOrder');

const isOrderAdmin = (user) => Boolean(user) && ORDER_ADMIN_ROLES.includes(user.role);

// The single place the order visibility rule lives. `user` is req.user (id and role loaded from
// the DB by `authenticate`), never request input. Every order query merges this into `where`.
const buildOrderScope = (user) => {
  if (!user?.id) throw new Error('buildOrderScope: authenticated user required');
  return isOrderAdmin(user) ? {} : { createdById: user.id };
};

module.exports = { isOrderAdmin, buildOrderScope };
