const z = require('zod');
const { Messages } = require('../constants/messages');
const { CafeOrderStatus, ORDER_SEARCH_MAX_LENGTH } = require('../constants/cafeOrder');
const { paginationQueryFields } = require('./pagination.validation');
const { sendValidationFailed } = require('../utils/validationError.util');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Rejects shapes like 2026-02-30 that the regex alone would accept.
const isCalendarDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const dateField = z
  .string({ error: Messages.ORDER_DATE_INVALID })
  .refine(isCalendarDate, { message: Messages.ORDER_DATE_INVALID })
  .optional();

// YYYY-MM-DD strings compare correctly as text.
const refineRange = (data, ctx) => {
  if (data.from && data.to && data.from > data.to) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: Messages.ORDER_DATE_RANGE_INVALID });
  }
};

// Strict: unknown keys (e.g. `source`, `userId`, `createdBy`) are rejected so no query parameter
// can ever widen the visibility scope or imply a filter that does not exist.
const strictObjectWith = (unknownKeyMessage) => (shape) =>
  z.strictObject(shape, {
    error: (issue) => (issue.code === 'unrecognized_keys' ? unknownKeyMessage : undefined),
  });
const strictQuery = strictObjectWith(Messages.ORDER_QUERY_UNKNOWN_FIELD);
const strictBody = strictObjectWith(Messages.ORDER_BODY_UNKNOWN_FIELD);

const listOrdersQuerySchema = strictQuery({
  from: dateField,
  to: dateField,
  status: z
    .enum(Object.values(CafeOrderStatus), { error: Messages.ORDER_STATUS_INVALID })
    .optional(),
  search: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z
      .string({ error: Messages.ORDER_SEARCH_INVALID })
      .max(ORDER_SEARCH_MAX_LENGTH, Messages.ORDER_SEARCH_INVALID)
      .optional(),
  ),
  ...paginationQueryFields,
}).superRefine(refineRange);

const orderSummaryQuerySchema = strictQuery({
  from: dateField,
  to: dateField,
}).superRefine(refineRange);

// The detail endpoint reads no query parameters; any present one is unknown and rejected.
const orderDetailQuerySchema = strictQuery({});

// PATCH /orders/:orderId/status body: exactly { status }, lowercase. Anything else is 400, so
// paymentStatus, totals or items can never be sent along with a status change.
const updateOrderStatusBodySchema = strictBody({
  status: z.enum(Object.values(CafeOrderStatus), { error: Messages.ORDER_STATUS_INVALID }),
});

const orderIdParamSchema = z.object({
  orderId: z.uuid({ error: Messages.ORDER_ID_INVALID }),
});

// unrecognized_keys has an empty path; report one error per offending key instead.
const expandIssues = (error) => ({
  issues: error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: [key], message: issue.message }))
      : [issue],
  ),
});

const validateWith = (schema, source, target) => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) return sendValidationFailed(res, expandIssues(result.error));
  req[target] = result.data;
  return next();
};

const validateListOrdersQuery = validateWith(listOrdersQuerySchema, 'query', 'validatedQuery');
const validateOrderSummaryQuery = validateWith(orderSummaryQuerySchema, 'query', 'validatedQuery');
const validateOrderIdParam = validateWith(orderIdParamSchema, 'params', 'validatedParams');
const validateOrderDetailQuery = validateWith(orderDetailQuerySchema, 'query', 'validatedQuery');
const validateUpdateOrderStatusBody = validateWith(
  updateOrderStatusBodySchema,
  'body',
  'validatedBody',
);

module.exports = {
  isCalendarDate,
  listOrdersQuerySchema,
  orderSummaryQuerySchema,
  orderDetailQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
  validateListOrdersQuery,
  validateOrderSummaryQuery,
  validateOrderIdParam,
  validateOrderDetailQuery,
  validateUpdateOrderStatusBody,
};
