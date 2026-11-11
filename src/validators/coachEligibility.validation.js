const z = require('zod');
const { Messages } = require('../constants/messages');
const { validateQuery } = require('../middlewares/validate.middleware');

const isoDateTime = (requiredMessage, invalidMessage) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? requiredMessage : invalidMessage) })
    .pipe(z.iso.datetime({ offset: true, error: invalidMessage }))
    .transform((value) => new Date(value));

// GET /coaches/eligible?startAt=...&(endAt=... | appointmentTypeId=...)[&excludeSessionId][&excludeAppointmentId]
// Strict: an unknown parameter is a 400. Exactly one of endAt / appointmentTypeId is required (with a
// type, the end and the buffers come from the type).
const eligibleCoachesQuerySchema = z
  .strictObject(
    {
      startAt: isoDateTime(Messages.ELIGIBLE_START_REQUIRED, Messages.ELIGIBLE_START_INVALID),
      endAt: isoDateTime(Messages.ELIGIBLE_END_INVALID, Messages.ELIGIBLE_END_INVALID).optional(),
      appointmentTypeId: z.uuid({ error: Messages.APPOINTMENT_TYPE_ID_INVALID }).optional(),
      excludeSessionId: z.uuid({ error: Messages.ELIGIBLE_SESSION_ID_INVALID }).optional(),
      excludeAppointmentId: z.uuid({ error: Messages.ELIGIBLE_APPOINTMENT_ID_INVALID }).optional(),
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
    },
  )
  .superRefine((query, ctx) => {
    if (query.endAt && query.appointmentTypeId) {
      ctx.addIssue({ code: 'custom', path: ['endAt'], message: Messages.ELIGIBLE_END_AND_TYPE });
      return;
    }
    if (!query.endAt && !query.appointmentTypeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: Messages.ELIGIBLE_END_OR_TYPE_REQUIRED,
      });
      return;
    }
    if (query.endAt && query.startAt && query.endAt <= query.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: Messages.ELIGIBLE_END_BEFORE_START,
      });
    }
  });

module.exports = {
  eligibleCoachesQuerySchema,
  validateEligibleCoachesQuery: validateQuery(eligibleCoachesQuerySchema),
};
