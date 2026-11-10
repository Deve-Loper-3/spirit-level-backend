const env = require('../config/env');
const { AppErrors } = require('../constants/errors');
const { createAppError } = require('../errors/AppError');
const { AuditAction } = require('../constants/audit');
const {
  API_TO_DB_ORDER_STATUS,
  DB_TO_API_ORDER_STATUS,
  ORDER_STATUS_TRANSITIONS,
} = require('../constants/cafeOrder');
const { buildOrderScope, isOrderAdmin } = require('./cafeOrder.access');
const { localDateTimeToUtc, getTodayInTimezone, addDaysToDateStr } = require('./schedule.service');
const {
  listOrders: findOrders,
  countOrders,
  findOrderById,
  getOrderSummary,
  findOrderStatusById,
  updateOrderStatusWithAudit,
} = require('../repositories/cafeOrder.repository');
const {
  toCafeOrderListResponse,
  toCafeOrderDetailResponse,
} = require('../repositories/cafeOrder.mapper');
const { toSkipTake, buildPagination } = require('../utils/pagination.util');
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require('../constants/pagination');

const facilityTimezone = () => env.FACILITY_TIMEZONE || 'Asia/Dubai';

// `from`/`to` are facility-local calendar dates, both inclusive. Returns a UTC { gte, lt } range
// (end is the start of the day after `to`), or undefined when neither bound is given.
const toCreatedAtRange = ({ from, to }, timeZone = facilityTimezone()) => {
  if (!from && !to) return undefined;
  const range = {};
  if (from) range.gte = localDateTimeToUtc(from, '00:00', timeZone);
  if (to) range.lt = localDateTimeToUtc(addDaysToDateStr(to, 1), '00:00', timeZone);
  return range;
};

const listOrders = async ({ user, query = {} }) => {
  const { from, to, status, search, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = query;
  const scope = buildOrderScope(user);
  const filters = {
    createdAt: toCreatedAtRange({ from, to }),
    status: status ? API_TO_DB_ORDER_STATUS[status] : undefined,
    search,
  };
  const { skip, take } = toSkipTake({ page, limit });

  const [orders, total] = await Promise.all([
    findOrders(scope, { ...filters, skip, take }),
    countOrders(scope, filters),
  ]);

  return {
    data: orders.map(toCafeOrderListResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getOrder = async ({ user, orderId }) => {
  const order = await findOrderById(buildOrderScope(user), orderId);
  // Out-of-scope and missing orders look the same, so existence is not leaked.
  if (!order) throw createAppError(AppErrors.ORDER_NOT_FOUND);
  return toCafeOrderDetailResponse(order);
};

// No revenue or totals here on purpose: payments are not tracked.
const getSummary = async ({ user, query = {} }) => {
  const timeZone = facilityTimezone();
  const today = getTodayInTimezone(timeZone);
  // A single bound defaults the other to today; neither defaults both.
  const from = query.from ?? (query.to && query.to < today ? query.to : today);
  const to = query.to ?? (from > today ? from : today);

  const { orderCount, preparingCount, itemSales } = await getOrderSummary(buildOrderScope(user), {
    createdAt: toCreatedAtRange({ from, to }, timeZone),
  });

  return {
    range: { from, to, timezone: timeZone },
    orderCount,
    preparingCount,
    topSeller: itemSales[0] ?? null,
    itemSalesHistory: itemSales,
  };
};

// Statuses (API, lowercase) that `from` may move to: at most one, never backward, none after served.
const getAllowedTransitions = (from) => {
  const next = ORDER_STATUS_TRANSITIONS[from];
  return next ? [next] : [];
};

const isAllowedTransition = (from, to) => getAllowedTransitions(from).includes(to);

const transitionConflict = (from, to) =>
  createAppError(AppErrors.INVALID_ORDER_STATUS_TRANSITION, undefined, undefined, {
    from,
    to,
    allowed: getAllowedTransitions(from),
  });

// `actor` is req.user (role from the DB). The route already limits this to OWNER/ADMIN; the check
// here keeps the rule true if the service is ever called from somewhere else.
const updateOrderStatus = async ({ actor, orderId, status, meta = {} }) => {
  if (!isOrderAdmin(actor)) throw createAppError(AppErrors.FORBIDDEN);

  const order = await findOrderStatusById(orderId);
  if (!order) throw createAppError(AppErrors.ORDER_NOT_FOUND);

  const from = DB_TO_API_ORDER_STATUS[order.status];
  if (!isAllowedTransition(from, status)) throw transitionConflict(from, status);

  const updated = await updateOrderStatusWithAudit({
    orderId,
    from: order.status,
    to: API_TO_DB_ORDER_STATUS[status],
    audit: {
      action: AuditAction.CAFE_ORDER_STATUS_CHANGED,
      userId: null,
      actorId: actor.id,
      actorRole: actor.role,
      reason: `${order.orderNumber} (${order.id})`,
      details: { orderId: order.id, orderNumber: order.orderNumber, from, to: status },
      meta,
    },
  });

  if (!updated) {
    // Lost a race: the order was deleted or its status changed after it was read.
    const current = await findOrderStatusById(orderId);
    if (!current) throw createAppError(AppErrors.ORDER_NOT_FOUND);
    throw transitionConflict(DB_TO_API_ORDER_STATUS[current.status], status);
  }

  return toCafeOrderDetailResponse(updated);
};

module.exports = {
  toCreatedAtRange,
  listOrders,
  getOrder,
  getSummary,
  getAllowedTransitions,
  isAllowedTransition,
  updateOrderStatus,
};
