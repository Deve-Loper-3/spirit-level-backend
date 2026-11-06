const prisma = require('../config/prisma');
const { DbCafeOrderStatus } = require('../constants/cafeOrder');
const { createAuditLog } = require('./audit-log.repository');
const { escapeLikePattern } = require('../utils/like.util');

// `scope` comes from cafeOrder.access.buildOrderScope and is always combined with AND, so no
// filter can overwrite or OR around it. `createdAt` is a { gte, lt } UTC range.
const buildOrderWhere = (scope, { createdAt, status, search } = {}) => {
  const conditions = [scope];

  if (createdAt) conditions.push({ createdAt });
  if (status) conditions.push({ status });

  const term = search?.trim();
  if (term) {
    const contains = { contains: escapeLikePattern(term), mode: 'insensitive' };
    conditions.push({
      OR: [
        { orderNumber: contains },
        { customerName: contains },
        { items: { some: { itemName: contains } } },
      ],
    });
  }

  return { AND: conditions };
};

const ORDER_LIST_SELECT = Object.freeze({
  id: true,
  orderNumber: true,
  status: true,
  customerName: true,
  totalAed: true,
  paymentStatus: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { items: true } },
});

const listOrders = async (scope, { skip = 0, take, ...filters } = {}, client = prisma) =>
  client.cafeOrder.findMany({
    where: buildOrderWhere(scope, filters),
    skip,
    take,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: ORDER_LIST_SELECT,
  });

const countOrders = async (scope, filters = {}, client = prisma) =>
  client.cafeOrder.count({ where: buildOrderWhere(scope, filters) });

// findFirst (not findUnique) so the scope applies: an order outside it is simply "not found".
const findOrderById = async (scope, orderId, client = prisma) =>
  client.cafeOrder.findFirst({
    where: { AND: [scope, { id: orderId }] },
    select: {
      ...ORDER_LIST_SELECT,
      items: {
        select: { id: true, itemName: true, unitPriceAed: true, quantity: true },
        orderBy: [{ itemName: 'asc' }, { id: 'asc' }],
      },
    },
  });

const getOrderSummary = async (scope, { createdAt }, client = prisma) => {
  const where = buildOrderWhere(scope, { createdAt });

  const [orderCount, preparingCount, itemSales] = await Promise.all([
    client.cafeOrder.count({ where }),
    client.cafeOrder.count({
      where: { AND: [where, { status: DbCafeOrderStatus.PREPARING }] },
    }),
    client.cafeOrderItem.groupBy({
      by: ['itemName'],
      where: { order: where },
      _sum: { quantity: true },
      orderBy: [{ _sum: { quantity: 'desc' } }, { itemName: 'asc' }],
    }),
  ]);

  return {
    orderCount,
    preparingCount,
    itemSales: itemSales.map((row) => ({ itemName: row.itemName, quantity: row._sum.quantity })),
  };
};

// Minimal read for the status endpoint: what is needed to check the transition.
const findOrderStatusById = async (orderId, client = prisma) =>
  client.cafeOrder.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true },
  });

// One conditional write: it only matches while the order still has the status the caller saw,
// so of two concurrent requests for the same step exactly one updates. Only `status` (and the
// automatic `updatedAt`) is written; payment status, totals and items are never touched. The
// audit row is written in the same transaction, and the detail view is re-read inside it.
// Returns null when nothing matched (order gone or status changed meanwhile).
const updateOrderStatusWithAudit = async ({ orderId, from, to, audit }, client = prisma) =>
  client.$transaction(async (tx) => {
    const { count } = await tx.cafeOrder.updateMany({
      where: { id: orderId, status: from },
      data: { status: to },
    });
    if (count === 0) return null;

    await createAuditLog(tx, audit);
    return findOrderById({}, orderId, tx);
  });

module.exports = {
  buildOrderWhere,
  listOrders,
  countOrders,
  findOrderById,
  getOrderSummary,
  findOrderStatusById,
  updateOrderStatusWithAudit,
};
