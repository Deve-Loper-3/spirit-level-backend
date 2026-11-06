const { Prisma } = require('@prisma/client');
const { DB_TO_API_ORDER_STATUS, DB_TO_API_PAYMENT_STATUS } = require('../constants/cafeOrder');
const { decimalToNumber } = require('./cafe.mapper');

// Line total in exact decimal arithmetic, then converted once, so 3 x 0.10 is 0.3 not 0.30000000000000004.
const lineTotal = (unitPrice, quantity) =>
  decimalToNumber(new Prisma.Decimal(unitPrice).mul(quantity));

const toCafeOrderListResponse = (order) => {
  if (!order) return null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: DB_TO_API_ORDER_STATUS[order.status],
    customerName: order.customerName ?? null,
    totalAed: decimalToNumber(order.totalAed),
    paymentStatus: DB_TO_API_PAYMENT_STATUS[order.paymentStatus],
    createdBy: order.createdBy
      ? { id: order.createdBy.id, fullName: order.createdBy.fullName }
      : null,
    itemCount: order._count?.items ?? 0,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

const toCafeOrderItemResponse = (item) => ({
  id: item.id,
  itemName: item.itemName,
  unitPriceAed: decimalToNumber(item.unitPriceAed),
  quantity: item.quantity,
  lineTotalAed: lineTotal(item.unitPriceAed, item.quantity),
});

const toCafeOrderDetailResponse = (order) => {
  if (!order) return null;
  return {
    ...toCafeOrderListResponse(order),
    items: (order.items ?? []).map(toCafeOrderItemResponse),
  };
};

module.exports = { toCafeOrderListResponse, toCafeOrderItemResponse, toCafeOrderDetailResponse };
