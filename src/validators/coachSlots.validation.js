const z = require('zod');
const { Messages } = require('../constants/messages');
const { OPEN_SLOTS_MAX_DAYS } = require('../constants/availability');
const { isCalendarDate } = require('./cafeOrder.validation');
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

// GET /coaches/:coachId/availability/slots?appointmentTypeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD[&excludeAppointmentId=...]
// Strict: an unknown parameter is a 400. `from` / `to` are inclusive facility days, at most
// OPEN_SLOTS_MAX_DAYS apart.
const openSlotsQuerySchema = z
  .strictObject(
    {
      appointmentTypeId: z.uuid({
        error: (issue) =>
          issue.input === undefined
            ? Messages.SLOTS_TYPE_REQUIRED
            : Messages.APPOINTMENT_TYPE_ID_INVALID,
      }),
      from: dateField(Messages.SLOTS_FROM_REQUIRED),
      to: dateField(Messages.SLOTS_TO_REQUIRED),
      excludeAppointmentId: z.uuid({ error: Messages.ELIGIBLE_APPOINTMENT_ID_INVALID }).optional(),
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
    },
  )
  .superRefine((query, ctx) => {
    if (!isCalendarDate(query.from ?? '') || !isCalendarDate(query.to ?? '')) return;
    if (query.to < query.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: Messages.SLOTS_RANGE_ORDER });
    } else if (daysBetweenInclusive(query.from, query.to) > OPEN_SLOTS_MAX_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: Messages.SLOTS_RANGE_TOO_LONG(OPEN_SLOTS_MAX_DAYS),
      });
    }
  });

module.exports = {
  openSlotsQuerySchema,
  validateOpenSlotsQuery: validateQuery(openSlotsQuerySchema),
};
