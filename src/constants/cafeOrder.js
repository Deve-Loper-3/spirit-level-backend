const { Role } = require('./roles');

// API values are lowercase; the DB enum is uppercase (same convention as cafe items).
const CafeOrderStatus = Object.freeze({
  PREPARING: 'preparing',
  READY: 'ready',
  SERVED: 'served',
});

const DbCafeOrderStatus = Object.freeze({
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'SERVED',
});

const API_TO_DB_ORDER_STATUS = Object.freeze({
  [CafeOrderStatus.PREPARING]: DbCafeOrderStatus.PREPARING,
  [CafeOrderStatus.READY]: DbCafeOrderStatus.READY,
  [CafeOrderStatus.SERVED]: DbCafeOrderStatus.SERVED,
});

const DB_TO_API_ORDER_STATUS = Object.freeze({
  [DbCafeOrderStatus.PREPARING]: CafeOrderStatus.PREPARING,
  [DbCafeOrderStatus.READY]: CafeOrderStatus.READY,
  [DbCafeOrderStatus.SERVED]: CafeOrderStatus.SERVED,
});

// The only allowed moves: one step forward. SERVED is final; there is no cancel and no way back.
// Keys and values are API (lowercase) statuses; null means no further transition.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [CafeOrderStatus.PREPARING]: CafeOrderStatus.READY,
  [CafeOrderStatus.READY]: CafeOrderStatus.SERVED,
  [CafeOrderStatus.SERVED]: null,
});

// Payments are not tracked. There is no other value and no code path that sets one.
const CafeOrderPaymentStatus = Object.freeze({ NOT_TRACKED: 'not_tracked' });
const DB_TO_API_PAYMENT_STATUS = Object.freeze({ NOT_TRACKED: CafeOrderPaymentStatus.NOT_TRACKED });

// Roles that may read the order queue at all. Admin roles see every order; the rest see only
// orders they created (enforced in cafeOrder.access, never from request input).
const ORDER_READ_ROLES = Object.freeze([Role.OWNER, Role.ADMIN, Role.COACH]);
const ORDER_ADMIN_ROLES = Object.freeze([Role.OWNER, Role.ADMIN]);

const ORDER_SEARCH_MAX_LENGTH = 100;

module.exports = Object.freeze({
  CafeOrderStatus,
  DbCafeOrderStatus,
  API_TO_DB_ORDER_STATUS,
  DB_TO_API_ORDER_STATUS,
  ORDER_STATUS_TRANSITIONS,
  CafeOrderPaymentStatus,
  DB_TO_API_PAYMENT_STATUS,
  ORDER_READ_ROLES,
  ORDER_ADMIN_ROLES,
  ORDER_SEARCH_MAX_LENGTH,
});
