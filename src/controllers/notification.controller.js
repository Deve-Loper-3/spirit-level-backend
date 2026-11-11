const service = require('../services/notification.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const listNotifications = async (req, res, next) => {
  try {
    const { data, pagination } = await service.listNotifications({
      userId: req.user.id,
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data, pagination });
  } catch (err) {
    return next(err);
  }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const data = await service.getUnreadCount({ userId: req.user.id });
    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const data = await service.markNotificationRead({
      userId: req.user.id,
      notificationId: req.params.notificationId,
    });
    return sendSuccess(res, { message: Messages.NOTIFICATION_READ_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    const data = await service.markAllNotificationsRead({ userId: req.user.id });
    return sendSuccess(res, { message: Messages.NOTIFICATIONS_READ_ALL_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};
