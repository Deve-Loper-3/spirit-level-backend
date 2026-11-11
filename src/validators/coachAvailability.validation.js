const z = require('zod');
const { Messages } = require('../constants/messages');
const {
  DAY_OF_WEEK_MIN,
  DAY_OF_WEEK_MAX,
  DAYS_PER_WEEK,
  DAY_LABELS,
  HH_MM_REGEX,
  MAX_SLOTS_PER_DAY,
  UNAVAILABILITY_REASON_MAX_LENGTH,
  UNAVAILABILITY_NOTE_MAX_LENGTH,
} = require('../constants/availability');
const { toMinuteRange, isValidRange, findOverlappingPair } = require('../utils/timeRange.util');
const { isCalendarDate } = require('./cafeOrder.validation');
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
const strictObject = (shape) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? Messages.ORDER_BODY_UNKNOWN_FIELD : undefined,
  });

// ==========================================
// Weekly availability (PUT /coaches/:coachId/availability)
// Body: { days: [{ dayOfWeek, isAvailable, slots: [{ startTime, endTime }] }] }
// The request replaces the whole week; a weekday that is not listed ends up with no saved hours.
// ==========================================

const timeField = (requiredMessage, invalidMessage) =>
  z
    .string({ error: requiredOr(requiredMessage, invalidMessage) })
    .regex(HH_MM_REGEX, invalidMessage);

const dayOfWeekField = z
  .number({ error: requiredOr(Messages.DAY_OF_WEEK_REQUIRED, Messages.DAY_OF_WEEK_INTEGER) })
  .int(Messages.DAY_OF_WEEK_INTEGER)
  .min(DAY_OF_WEEK_MIN, Messages.DAY_OF_WEEK_RANGE_DAYS)
  .max(DAY_OF_WEEK_MAX, Messages.DAY_OF_WEEK_RANGE_DAYS);

const availabilitySlotSchema = strictObject({
  startTime: timeField(Messages.SLOT_START_TIME_REQUIRED, Messages.SLOT_START_TIME_INVALID),
  endTime: timeField(Messages.SLOT_END_TIME_REQUIRED, Messages.SLOT_END_TIME_INVALID),
}).superRefine((slot, ctx) => {
  const range = toMinuteRange(slot);
  if (range && !isValidRange(range)) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: Messages.SLOT_END_BEFORE_START });
  }
});

const slotText = ({ startTime, endTime }) => `${startTime}-${endTime}`;

const byStartTime = (a, b) => a.startTime.localeCompare(b.startTime);

// One weekday. An available day needs at least one range, an unavailable day has none. Ranges of a
// day must not overlap (touching ranges, e.g. 09:00-12:00 and 12:00-15:00, are allowed).
const availabilityDaySchema = strictObject({
  dayOfWeek: dayOfWeekField,
  isAvailable: z.boolean({ error: Messages.AVAILABILITY_IS_AVAILABLE_INVALID }),
  slots: z
    .array(availabilitySlotSchema, {
      error: Messages.AVAILABILITY_SLOTS_INVALID(MAX_SLOTS_PER_DAY),
    })
    .max(MAX_SLOTS_PER_DAY, Messages.AVAILABILITY_SLOTS_INVALID(MAX_SLOTS_PER_DAY))
    .default([]),
})
  .superRefine((day, ctx) => {
    if (day.isAvailable && day.slots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots'],
        message: Messages.AVAILABILITY_SLOTS_REQUIRED,
      });
    }
    if (!day.isAvailable && day.slots.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots'],
        message: Messages.AVAILABILITY_SLOTS_NOT_ALLOWED,
      });
    }

    const ranges = day.slots.map(toMinuteRange);
    if (ranges.some((range) => !isValidRange(range))) return; // reported on the slot itself
    const pair = findOverlappingPair(ranges);
    if (pair) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots', Math.max(pair[0], pair[1]), 'startTime'],
        message: Messages.AVAILABILITY_SLOTS_OVERLAP_DETAIL(
          DAY_LABELS[day.dayOfWeek] ?? `dayOfWeek ${day.dayOfWeek}`,
          slotText(day.slots[pair[0]]),
          slotText(day.slots[pair[1]]),
        ),
      });
    }
  })
  // Slots are returned in time order, whatever order the client sent them in.
  .transform((day) => ({ ...day, slots: [...day.slots].sort(byStartTime) }));

const saveWeeklyAvailabilityBodySchema = strictObject({
  days: z
    .array(availabilityDaySchema, { error: Messages.AVAILABILITY_DAYS_INVALID })
    // Not `.length()`: Zod runs a length check even after the type check failed, as long as the value
    // has a `length` property, so the string 'x' got the same message twice. A refine is skipped
    // once the type check has failed, so a non-array `days` gets exactly one issue.
    .refine((days) => days.length === DAYS_PER_WEEK, {
      message: Messages.AVAILABILITY_DAYS_INVALID,
    }),
}).superRefine((body, ctx) => {
  // The request replaces the whole week: exactly 7 entries, each weekday once. A wrong count is
  // reported on `days`, a repeated weekday on its own entry, and the weekdays that are absent on `days`.
  const seen = new Set();
  body.days.forEach((day, index) => {
    if (seen.has(day.dayOfWeek)) {
      ctx.addIssue({
        code: 'custom',
        path: ['days', index, 'dayOfWeek'],
        message: Messages.AVAILABILITY_DAY_DUPLICATE,
      });
    }
    seen.add(day.dayOfWeek);
  });

  const missing = [];
  for (let dayOfWeek = DAY_OF_WEEK_MIN; dayOfWeek <= DAY_OF_WEEK_MAX; dayOfWeek += 1) {
    if (!seen.has(dayOfWeek)) missing.push(dayOfWeek);
  }
  if (missing.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['days'],
      message: Messages.AVAILABILITY_DAYS_MISSING(missing),
    });
  }
});

// ==========================================
// Unavailability / leave
// Create: { startDate, endDate, reason, note? }   Update: any subset, at least one field.
// Dates are inclusive facility-local YYYY-MM-DD. The "no past dates" rule needs the facility
// clock and the stored row, so it lives in the service, not here.
// ==========================================

const dateField = (requiredMessage, invalidMessage) =>
  z
    .string({ error: requiredOr(requiredMessage, invalidMessage) })
    .refine(isCalendarDate, { message: invalidMessage });

const startDateField = dateField(Messages.START_DATE_REQUIRED, Messages.START_DATE_INVALID);
const endDateField = dateField(
  Messages.UNAVAILABILITY_END_DATE_REQUIRED,
  Messages.UNAVAILABILITY_END_DATE_INVALID,
);

const reasonField = z
  .string({
    error: requiredOr(
      Messages.UNAVAILABILITY_REASON_REQUIRED,
      Messages.UNAVAILABILITY_REASON_INVALID(UNAVAILABILITY_REASON_MAX_LENGTH),
    ),
  })
  .trim()
  .min(1, Messages.UNAVAILABILITY_REASON_REQUIRED)
  .max(
    UNAVAILABILITY_REASON_MAX_LENGTH,
    Messages.UNAVAILABILITY_REASON_INVALID(UNAVAILABILITY_REASON_MAX_LENGTH),
  );

// Optional note; omitted, null and blank all mean "no note" and are stored as null.
const noteField = z
  .string({ error: Messages.UNAVAILABILITY_NOTE_INVALID(UNAVAILABILITY_NOTE_MAX_LENGTH) })
  .trim()
  .max(
    UNAVAILABILITY_NOTE_MAX_LENGTH,
    Messages.UNAVAILABILITY_NOTE_INVALID(UNAVAILABILITY_NOTE_MAX_LENGTH),
  )
  .nullish();

// YYYY-MM-DD strings compare correctly as text. Only checked when both dates are valid.
const refineDateOrder = (data, ctx) => {
  if (
    isCalendarDate(data.startDate ?? '') &&
    isCalendarDate(data.endDate ?? '') &&
    data.endDate < data.startDate
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: Messages.UNAVAILABILITY_END_BEFORE_START,
    });
  }
};

const createUnavailabilityBodySchema = strictObject({
  startDate: startDateField,
  endDate: endDateField,
  reason: reasonField,
  note: noteField,
})
  .superRefine(refineDateOrder)
  .transform((data) => ({ ...data, note: data.note || null }));

const updateUnavailabilityBodySchema = strictObject({
  startDate: startDateField.optional(),
  endDate: endDateField.optional(),
  reason: reasonField.optional(),
  note: noteField,
})
  .superRefine((data, ctx) => {
    if (Object.values(data).every((value) => value === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: Messages.UNAVAILABILITY_UPDATE_EMPTY });
      return;
    }
    refineDateOrder(data, ctx);
  })
  // Keep only the fields that were sent; a sent blank or null note clears it (null).
  .transform((data) => {
    const sent = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    return 'note' in sent ? { ...sent, note: sent.note || null } : sent;
  });

// GET list: optional window (leave that touches [from, to]) and the shared page / limit. Strict, so
// an unknown query parameter is a 400 and never silently ignored.
const queryDateField = z
  .string({ error: Messages.ORDER_DATE_INVALID })
  .refine(isCalendarDate, { message: Messages.ORDER_DATE_INVALID })
  .optional();

const listUnavailabilityQuerySchema = z
  .strictObject(
    { from: queryDateField, to: queryDateField, ...paginationQueryFields },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys' ? Messages.ORDER_QUERY_UNKNOWN_FIELD : undefined,
    },
  )
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: Messages.ORDER_DATE_RANGE_INVALID });
    }
  });

const unavailabilityParamsSchema = z.looseObject({
  coachId: z.uuid({ error: Messages.COACH_ID_INVALID }),
  unavailabilityId: z.uuid({ error: Messages.UNAVAILABILITY_ID_INVALID }),
});

const validateSaveWeeklyAvailabilityBody = validateBody(saveWeeklyAvailabilityBodySchema);
const validateCreateUnavailabilityBody = validateBody(createUnavailabilityBodySchema);
const validateUpdateUnavailabilityBody = validateBody(updateUnavailabilityBodySchema);
const validateUnavailabilityParams = validateParams(unavailabilityParamsSchema);
const validateListUnavailabilityQuery = validateQuery(listUnavailabilityQuerySchema);

module.exports = {
  saveWeeklyAvailabilityBodySchema,
  createUnavailabilityBodySchema,
  updateUnavailabilityBodySchema,
  unavailabilityParamsSchema,
  listUnavailabilityQuerySchema,
  validateSaveWeeklyAvailabilityBody,
  validateCreateUnavailabilityBody,
  validateUpdateUnavailabilityBody,
  validateUnavailabilityParams,
  validateListUnavailabilityQuery,
};
