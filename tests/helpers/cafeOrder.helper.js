const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../../src/config/prisma');

// Order creation is out of scope for SLAPP-79/82, so tests seed orders directly. Every order
// number starts with `prefix`, which is how cleanup finds them (items cascade).
const createTestCafeOrder = async (
  prefix,
  {
    createdById,
    items = [{ itemName: 'Flat White', unitPriceAed: '18.00', quantity: 1 }],
    ...rest
  },
  client = prisma,
) => {
  if (!createdById) throw new Error('createTestCafeOrder: createdById is required');
  const totalAed = items.reduce(
    (sum, item) => sum.add(new Prisma.Decimal(item.unitPriceAed).mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  return client.cafeOrder.create({
    data: {
      id: crypto.randomUUID(),
      orderNumber: `${prefix}${crypto.randomUUID().slice(0, 8)}`,
      createdById,
      totalAed,
      ...rest,
      items: {
        create: items.map((item) => ({ id: crypto.randomUUID(), ...item })),
      },
    },
    include: { items: true },
  });
};

const deleteTestCafeOrders = async (prefix, client = prisma) =>
  client.cafeOrder.deleteMany({ where: { orderNumber: { startsWith: prefix } } });

module.exports = { createTestCafeOrder, deleteTestCafeOrders };
