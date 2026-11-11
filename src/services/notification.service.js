const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const repo = require('../repositories/notification.repository');
const { toNotificationResponse } = require('../repositories/notification.mapper');
const { buildPagination } = require('../utils/pagination.util');

// In-app notifications. Every function takes the CALLER's user id and only ever touches that user's rows;
// there is no role check on purpose (any signed-in role has notifications). Somebody else's notification is
// reported as not found, never as forbidden.

const listNotifications = async ({ userId, query }) => {
  const { unread, page, limit } = query;
  const { rows, total } = await repo.listNotifications({
    userId,
    unreadOnly: unread === true,
    page,
    limit,
  });
  return {
    data: rows.map(toNotificationResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

const getUnreadCount = async ({ userId }) => ({ unreadCount: await repo.countUnread(userId) });

// Idempotent: reading an already-read notification returns it unchanged (the first read time is kept).
const markNotificationRead = async ({ userId, notificationId, now = new Date() }) => {
  await repo.markRead(userId, notificationId, now);
  const notification = await repo.findOwnedNotification(userId, notificationId);
  if (!notification) throw createAppError(AppErrors.NOTIFICATION_NOT_FOUND);
  return toNotificationResponse(notification);
};

const markAllNotificationsRead = async ({ userId, now = new Date() }) => ({
  updatedCount: await repo.markAllRead(userId, now),
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};
