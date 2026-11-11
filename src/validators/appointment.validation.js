const z = require('zod');
const { Messages } = require('../constants/messages');
const {
  AppointmentState,
  APPOINTMENT_TYPE_NAME_MAX_LENGTH,
  APPOINTMENT_DURATION_MIN,
  APPOINTMENT_DURATION_MAX,
  APPOINTMENT_BUFFER_MAX,
} = require('../constants/appointment');
const {
  validateBody,
  validateParams,
  validateQuery,
} = require('../middlewares/validate.middleware');
const { paginationQueryFields } = require('./pagination.validation');

// A missing value gets the "required" text, a wrong type or format the "invalid" text.
const requiredOr = (requiredMessage, invalidMessage) => (issue) =>
  issue.input === undefined ? requiredMessage : invalidMessage;

// Strict: unknown keys are rejected, so a client typo is never silently ignored.
const strictObject = (shape, unknownMessage = Messages.ORDER_BODY_UNKNOWN_FIELD) =>
  z.strictObject(shape, {
    error: (issue) => (issue.code === 'unrecognized_keys' ? unknownMessage : undefined),
  });

const uuidField = (requiredMessage, invalidMessage) =>
  z.uuid({ error: requiredOr(requiredMessage, invalidMessage) });

// ==========================================
// Appointment types
// Create: { name, durationMin, bufferBeforeMin?, bufferAfterMin?, isActive? }
// Update: any subset, at least one field. Types are deactivated (isActive = false), never deleted.
// ==========================================

const nameInvalid = Messages.APPOINTMENT_TYPE_NAME_INVALID(APPOINTMENT_TYPE_NAME_MAX_LENGTH);

const nameField = z
  .string({ error: requiredOr(Messages.APPOINTMENT_TYPE_NAME_REQUIRED, nameInvalid) })
  .trim()
  .min(1, nameInvalid)
  .max(APPOINTMENT_TYPE_NAME_MAX_LENGTH, nameInvalid);

const durationInvalid = Messages.APPOINTMENT_TYPE_DURATION_INVALID(
  APPOINTMENT_DURATION_MIN,
  APPOINTMENT_DURATION_MAX,
);

const durationField = z
  .number({ error: durationInvalid })
  .int(durationInvalid)
  .min(APPOINTMENT_DURATION_MIN, durationInvalid)
  .max(APPOINTMENT_DURATION_MAX, durationInvalid);

const bufferField = (field) => {
  const invalid = Messages.APPOINTMENT_TYPE_BUFFER_INVALID(field, APPOINTMENT_BUFFER_MAX);
  return z
    .number({ error: invalid })
    .int(invalid)
    .min(0, invalid)
    .max(APPOINTMENT_BUFFER_MAX, invalid);
};

const isActiveField = z.boolean({ error: Messages.APPOINTMENT_TYPE_IS_ACTIVE_INVALID });

const createAppointmentTypeBodySchema = strictObject({
  name: nameField,
  durationMin: durationField,
  bufferBeforeMin: bufferField('bufferBeforeMin').default(0),
  bufferAfterMin: bufferField('bufferAfterMin').default(0),
  isActive: isActiveField.default(true),
});

const updateAppointmentTypeBodySchema = strictObject({
  name: nameField.optional(),
  durationMin: durationField.optional(),
  bufferBeforeMin: bufferField('bufferBeforeMin').optional(),
  bufferAfterMin: bufferField('bufferAfterMin').optional(),
  isActive: isActiveField.optional(),
})
  .superRefine((data, ctx) => {
    if (Object.values(data).every((value) => value === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: Messages.APPOINTMENT_TYPE_UPDATE_EMPTY });
    }
  })
  // Keep only the fields that were sent.
  .transform((data) =>
    Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
  );

// ?isActive=true|false (exact lowercase), plus the shared page / limit. Strict: unknown parameters are 400.
const unknownQuery = (issue) =>
  issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined;

const listAppointmentTypesQuerySchema = z.strictObject(
  {
    isActive: z
      .enum(['true', 'false'], { error: Messages.APPOINTMENT_TYPE_IS_ACTIVE_INVALID })
      .transform((value) => value === 'true')
      .optional(),
    ...paginationQueryFields,
  },
  { error: unknownQuery },
);

const appointmentTypeParamsSchema = z.looseObject({
  typeId: z.uuid({ error: Messages.APPOINTMENT_TYPE_ID_INVALID }),
});

// ==========================================
// Appointments
// Create: { coachId, memberId, appointmentTypeId, startAt }  (startAt: ISO 8601 with Z or offset)
// ==========================================

const isoDateTime = (requiredMessage, invalidMessage) =>
  z
    .string({ error: requiredOr(requiredMessage, invalidMessage) })
    .pipe(z.iso.datetime({ offset: true, error: invalidMessage }))
    .transform((value) => new Date(value));

const createAppointmentBodySchema = strictObject({
  coachId: uuidField(Messages.APPOINTMENT_COACH_ID_REQUIRED, Messages.COACH_ID_INVALID),
  memberId: uuidField(
    Messages.APPOINTMENT_MEMBER_ID_REQUIRED,
    Messages.APPOINTMENT_MEMBER_ID_INVALID,
  ),
  appointmentTypeId: uuidField(
    Messages.APPOINTMENT_TYPE_ID_REQUIRED,
    Messages.APPOINTMENT_TYPE_ID_INVALID,
  ),
  startAt: isoDateTime(Messages.APPOINTMENT_START_REQUIRED, Messages.APPOINTMENT_START_INVALID),
});

const optionalIso = (invalidMessage) => isoDateTime(invalidMessage, invalidMessage).optional();

const listAppointmentsQuerySchema = z
  .strictObject(
    {
      coachId: z.uuid({ error: Messages.COACH_ID_INVALID }).optional(),
      memberId: z.uuid({ error: Messages.APPOINTMENT_MEMBER_ID_INVALID }).optional(),
      state: z
        .enum(Object.values(AppointmentState), { error: Messages.APPOINTMENT_STATE_INVALID })
        .optional(),
      from: optionalIso(Messages.APPOINTMENT_FROM_INVALID),
      to: optionalIso(Messages.APPOINTMENT_TO_INVALID),
      ...paginationQueryFields,
    },
    { error: unknownQuery },
  )
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from >= query.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: Messages.APPOINTMENT_RANGE_INVALID });
    }
  });

const appointmentParamsSchema = z.looseObject({
  appointmentId: z.uuid({ error: Messages.APPOINTMENT_ID_INVALID }),
});

module.exports = {
  createAppointmentTypeBodySchema,
  updateAppointmentTypeBodySchema,
  listAppointmentTypesQuerySchema,
  appointmentTypeParamsSchema,
  createAppointmentBodySchema,
  listAppointmentsQuerySchema,
  appointmentParamsSchema,
  validateCreateAppointmentTypeBody: validateBody(createAppointmentTypeBodySchema),
  validateUpdateAppointmentTypeBody: validateBody(updateAppointmentTypeBodySchema),
  validateListAppointmentTypesQuery: validateQuery(listAppointmentTypesQuerySchema),
  validateAppointmentTypeParams: validateParams(appointmentTypeParamsSchema),
  validateCreateAppointmentBody: validateBody(createAppointmentBodySchema),
  validateListAppointmentsQuery: validateQuery(listAppointmentsQuerySchema),
  validateAppointmentParams: validateParams(appointmentParamsSchema),
};
