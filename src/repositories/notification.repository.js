const crypto = require('crypto');
const prisma = require('../config/prisma');
const { toSkipTake } = require('../utils/pagination.util');

// `client` is the prisma client or a transaction client. Every read and write takes the owner's user id:
// a notification of someone else is simply not found.

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
};

// Many notifications in ONE statement. Returns the number inserted.
const createNotifications = async (items, client = prisma) => {
  if (items.length === 0) return 0;
  const { count } = await client.notification.createMany({
    data: items.map((item) => ({ id: crypto.randomUUID(), ...item })),
  });
  return count;
};

// One page, newest first (id breaks ties), plus the total: 2 queries.
const listNotifications = async ({ userId, unreadOnly, page, limit }, client = prisma) => {
  const where = { userId, ...(unreadOnly && { readAt: null }) };
  const [rows, total] = await Promise.all([
    client.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake({ page, limit }),
    }),
    client.notification.count({ where }),
  ]);
  return { rows, total };
};

const countUnread = (userId, client = prisma) =>
  client.notification.count({ where: { userId, readAt: null } });

const findOwnedNotification = (userId, id, client = prisma) =>
  client.notification.findFirst({ where: { id, userId }, select: NOTIFICATION_SELECT });

// Sets readAt only on an unread row of this user, so a repeated call keeps the first read time.
const markRead = async (userId, id, readAt, client = prisma) => {
  const { count } = await client.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt },
  });
  return count;
};

const markAllRead = async (userId, readAt, client = prisma) => {
  const { count } = await client.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt },
  });
  return count;
};

module.exports = {
  createNotifications,
  listNotifications,
  countUnread,
  findOwnedNotification,
  markRead,
  markAllRead,
};
