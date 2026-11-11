const z = require('zod');
const { Messages } = require('../constants/messages');
const { COVERAGE_MAX_DAYS } = require('../constants/availability');
const { isCalendarDate } = require('./cafeOrder.validation');
const { paginationQueryFields } = require('./pagination.validation');
const { validateQuery } = require('../middlewares/validate.middleware');

const dateField = (requiredMessage) =>
  z
    .string({
      error: (issue) => (issue.input === undefined ? requiredMessage : Messages.ORDER_DATE_INVALID),
    })
    .refine(isCalendarDate, { message: Messages.ORDER_DATE_INVALID });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysBetweenInclusive = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY) + 1;

// GET /sessions/coverage?from=YYYY-MM-DD&to=YYYY-MM-DD[&coachId][&classId][&page][&limit]
// Strict: an unknown parameter is a 400. `from` / `to` are inclusive facility days, at most
// COVERAGE_MAX_DAYS apart.
const sessionCoverageQuerySchema = z
  .strictObject(
    {
      from: dateField(Messages.COVERAGE_FROM_REQUIRED),
      to: dateField(Messages.COVERAGE_TO_REQUIRED),
      coachId: z.uuid({ error: Messages.COVERAGE_COACH_ID_INVALID }).optional(),
      classId: z.uuid({ error: Messages.COVERAGE_CLASS_ID_INVALID }).optional(),
      ...paginationQueryFields,
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
    },
  )
  .superRefine((query, ctx) => {
    if (!isCalendarDate(query.from ?? '') || !isCalendarDate(query.to ?? '')) return;
    if (query.to < query.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: Messages.COVERAGE_RANGE_ORDER });
    } else if (daysBetweenInclusive(query.from, query.to) > COVERAGE_MAX_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: Messages.COVERAGE_RANGE_TOO_LONG(COVERAGE_MAX_DAYS),
      });
    }
  });

module.exports = {
  sessionCoverageQuerySchema,
  validateSessionCoverageQuery: validateQuery(sessionCoverageQuerySchema),
};
