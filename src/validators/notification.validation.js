const z = require('zod');
const { Messages } = require('../constants/messages');
const { paginationQueryFields } = require('./pagination.validation');
const { validateQuery, validateParams } = require('../middlewares/validate.middleware');

// GET /notifications?unread=true&page=1&limit=20. Strict: an unknown parameter is a 400. `unread` is the
// exact lowercase 'true' or 'false' ('false' = no filter).
const listNotificationsQuerySchema = z.strictObject(
  {
    unread: z
      .enum(['true', 'false'], { error: Messages.NOTIFICATION_UNREAD_INVALID })
      .transform((value) => value === 'true')
      .optional(),
    ...paginationQueryFields,
  },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
  },
);

// The endpoints with no input at all reject any query parameter the same way.
const emptyQuerySchema = z.strictObject(
  {},
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
  },
);

const notificationParamsSchema = z.looseObject({
  notificationId: z.uuid({ error: Messages.NOTIFICATION_ID_INVALID }),
});

module.exports = {
  listNotificationsQuerySchema,
  emptyQuerySchema,
  notificationParamsSchema,
  validateListNotificationsQuery: validateQuery(listNotificationsQuerySchema),
  validateEmptyQuery: validateQuery(emptyQuerySchema),
  validateNotificationParams: validateParams(notificationParamsSchema),
};
