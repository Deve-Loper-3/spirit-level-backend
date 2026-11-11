// Notification as the API returns it: ISO 8601 UTC timestamps, `readAt` is an explicit null while unread.
const toNotificationResponse = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data ?? {},
  readAt: row.readAt ? row.readAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
});

module.exports = { toNotificationResponse };
