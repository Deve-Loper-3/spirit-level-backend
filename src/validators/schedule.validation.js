const z = require('zod');
const { Messages } = require('../constants/messages');
const { sendValidationFailed } = require('../utils/validationError.util');
const { paginationQueryFields } = require('./pagination.validation');
const { SESSION_CAPACITY_MIN, SESSION_CAPACITY_MAX } = require('../constants/session');

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidDateString = (str) => {
  if (!DATE_REGEX.test(str)) return false;
  const d = new Date(str + 'T00:00:00.000Z');
  return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === str;
};

const isValidIsoDateTime = (str) => {
  if (typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
};

// ==========================================
// Slot Validation Schemas
// ==========================================

const slotTimeEntrySchema = z
  .object({
    startTime: z
      .string({ error: Messages.SLOT_START_TIME_REQUIRED })
      .regex(TIME_REGEX, Messages.SLOT_START_TIME_INVALID),
    endTime: z
      .string({ error: Messages.SLOT_END_TIME_REQUIRED })
      .regex(TIME_REGEX, Messages.SLOT_END_TIME_INVALID),
    coachIds: z
      .array(z.string().regex(UUID_REGEX, Messages.COACH_IDS_ITEM_INVALID))
      .optional()
      .default([]),
    capacity: z
      .number()
      .int(Messages.SESSION_CAPACITY_INTEGER)
      .min(SESSION_CAPACITY_MIN, Messages.SESSION_CAPACITY_MIN_MSG(SESSION_CAPACITY_MIN))
      .max(SESSION_CAPACITY_MAX, Messages.SESSION_CAPACITY_MAX_MSG(SESSION_CAPACITY_MAX))
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: Messages.SLOT_END_BEFORE_START,
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: Messages.COACH_IDS_DUPLICATE,
        });
      }
    }
  });

const slotDayEntrySchema = z
  .object({
    dayOfWeek: z
      .number({ error: Messages.DAY_OF_WEEK_REQUIRED })
      .int(Messages.DAY_OF_WEEK_INTEGER)
      .min(1, Messages.DAY_OF_WEEK_RANGE_DAYS)
      .max(7, Messages.DAY_OF_WEEK_RANGE_DAYS),
    times: z.array(slotTimeEntrySchema).min(1, Messages.SLOT_TIMES_REQUIRED),
  })
  .superRefine((data, ctx) => {
    const startTimes = new Set();
    data.times.forEach((t, idx) => {
      if (startTimes.has(t.startTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['times', idx, 'startTime'],
          message: Messages.SLOT_START_TIME_DUPLICATE(t.startTime, data.dayOfWeek),
        });
      }
      startTimes.add(t.startTime);
    });
  });

const createSlotsBodySchema = z
  .object({
    startDate: z
      .string({ error: Messages.START_DATE_REQUIRED })
      .refine(isValidDateString, Messages.START_DATE_INVALID),
    days: z
      .array(slotDayEntrySchema)
      .min(1, Messages.SLOT_DAYS_REQUIRED)
      .max(7, Messages.SLOT_DAYS_MAX),
  })
  .superRefine((data, ctx) => {
    const daysSeen = new Set();
    data.days.forEach((d, idx) => {
      if (daysSeen.has(d.dayOfWeek)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', idx, 'dayOfWeek'],
          message: Messages.SLOT_DAY_DUPLICATE(d.dayOfWeek),
        });
      }
      daysSeen.add(d.dayOfWeek);
    });
  });

const updateSlotBodySchema = z
  .object({
    dayOfWeek: z
      .number()
      .int()
      .min(1, Messages.DAY_OF_WEEK_RANGE)
      .max(7, Messages.DAY_OF_WEEK_RANGE)
      .optional(),
    startDate: z.string().refine(isValidDateString, Messages.START_DATE_INVALID).optional(),
    startTime: z.string().regex(TIME_REGEX, Messages.SLOT_START_TIME_FORMAT).optional(),
    endTime: z.string().regex(TIME_REGEX, Messages.SLOT_END_TIME_FORMAT).optional(),
    capacity: z
      .number()
      .int()
      .min(SESSION_CAPACITY_MIN)
      .max(SESSION_CAPACITY_MAX)
      .nullable()
      .optional(),
    coachIds: z.array(z.string().regex(UUID_REGEX, Messages.COACH_IDS_ITEM_INVALID)).optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: Messages.SLOT_UPDATE_EMPTY,
      });
    }
    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: Messages.SLOT_END_BEFORE_START,
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: Messages.COACH_IDS_DUPLICATE,
        });
      }
    }
  });

const listSlotsQuerySchema = z.object({
  includeInactive: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.enum(['true', 'false']),
    )
    .optional(),
});

// ==========================================
// Session Validation Schemas
// ==========================================

const listSessionsQuerySchema = z
  .object({
    from: z
      .string({ error: Messages.SESSION_FROM_REQUIRED })
      .refine(isValidIsoDateTime, Messages.SESSION_FROM_INVALID),
    to: z
      .string({ error: Messages.SESSION_TO_REQUIRED })
      .refine(isValidIsoDateTime, Messages.SESSION_TO_INVALID),
    classId: z.string().regex(UUID_REGEX, Messages.SESSION_CLASS_ID_FILTER_INVALID).optional(),
    coachId: z.string().regex(UUID_REGEX, Messages.SESSION_COACH_ID_FILTER_INVALID).optional(),
    state: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['open', 'full', 'cancelled']),
      )
      .optional(),
    isPrivate: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v),
        z.boolean(),
      )
      .optional(),
    ...paginationQueryFields,
  })
  .superRefine((data, ctx) => {
    const fromDate = new Date(data.from);
    const toDate = new Date(data.to);

    if (toDate < fromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: Messages.SESSION_RANGE_INVALID,
      });
    }

    const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 92) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: Messages.SESSION_RANGE_TOO_LONG,
      });
    }
  });

const createSessionBodySchema = z
  .object({
    classId: z
      .string({ error: Messages.SESSION_CLASS_ID_REQUIRED })
      .regex(UUID_REGEX, Messages.SESSION_CLASS_ID_FILTER_INVALID),
    startAt: z
      .string({ error: Messages.SESSION_START_REQUIRED })
      .refine(isValidIsoDateTime, Messages.SESSION_START_INVALID),
    endAt: z
      .string({ error: Messages.SESSION_END_REQUIRED })
      .refine(isValidIsoDateTime, Messages.SESSION_END_INVALID),
    durationMin: z
      .number()
      .int(Messages.SESSION_DURATION_INTEGER)
      .min(15, Messages.SESSION_DURATION_MIN)
      .max(240, Messages.SESSION_DURATION_MAX)
      .optional(),
    coachIds: z.array(z.string().regex(UUID_REGEX, Messages.COACH_IDS_ITEM_INVALID)).optional(),
    capacity: z
      .number()
      .int(Messages.SESSION_CAPACITY_INTEGER)
      .min(SESSION_CAPACITY_MIN, Messages.SESSION_CAPACITY_MIN_MSG(SESSION_CAPACITY_MIN))
      .max(SESSION_CAPACITY_MAX, Messages.SESSION_CAPACITY_MAX_MSG(SESSION_CAPACITY_MAX))
      .nullable()
      .optional(),
    intensity: z.number().int().min(1).max(5).optional(),
    classType: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['onsite', 'online']),
      )
      .optional(),
    facility: z.string().trim().max(100).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    image: z.string().trim().max(2048).optional().nullable(),
    isPrivate: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: Messages.SESSION_END_BEFORE_START,
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: Messages.COACH_IDS_DUPLICATE,
        });
      }
    }
  });

const patchSessionBodySchema = z
  .object({
    capacity: z.number().int().min(SESSION_CAPACITY_MIN).max(SESSION_CAPACITY_MAX).optional(),
    startAt: z.string().refine(isValidIsoDateTime, Messages.SESSION_START_INVALID).optional(),
    endAt: z.string().refine(isValidIsoDateTime, Messages.SESSION_END_INVALID).optional(),
    durationMin: z.number().int().min(15).max(240).optional(),
    coachIds: z.array(z.string().regex(UUID_REGEX, Messages.COACH_IDS_ITEM_INVALID)).optional(),
    intensity: z.number().int().min(1).max(5).optional(),
    classType: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['onsite', 'online']),
      )
      .optional(),
    facility: z.string().trim().max(100).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    image: z.string().trim().max(2048).optional().nullable(),
    isPrivate: z.boolean().optional(),
    version: z.number().int().positive().optional(),
    overrideReasons: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    const keys = Object.keys(data).filter(
      (k) => k !== 'overrideReasons' && k !== 'version' && data[k] !== undefined,
    );
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: Messages.SESSION_UPDATE_EMPTY,
      });
    }
    if (data.startAt && data.endAt) {
      const start = new Date(data.startAt);
      const end = new Date(data.endAt);
      if (end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: Messages.SESSION_END_BEFORE_START,
        });
      }
    }
  });

const cancelSessionBodySchema = z.object({
  reason: z
    .string({ error: Messages.SESSION_CANCEL_REASON_FIELD_REQUIRED })
    .trim()
    .min(1, Messages.SESSION_CANCEL_REASON_EMPTY)
    .max(500, Messages.SESSION_CANCEL_REASON_TOO_LONG),
});

// Middleware Functions
const validateListSlotsQuery = (req, res, next) => {
  const result = listSlotsQuerySchema.safeParse(req.query ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

const validateCreateSlotsBody = (req, res, next) => {
  const result = createSlotsBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.body = result.data;
  return next();
};

const validateUpdateSlotBody = (req, res, next) => {
  const result = updateSlotBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.body = result.data;
  return next();
};

const validateListSessionsQuery = (req, res, next) => {
  const result = listSessionsQuerySchema.safeParse(req.query ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

const validateCreateSessionBody = (req, res, next) => {
  const result = createSessionBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.body = result.data;
  return next();
};

const validatePatchSessionBody = (req, res, next) => {
  const result = patchSessionBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.body = result.data;
  return next();
};

const validateCancelSessionBody = (req, res, next) => {
  const result = cancelSessionBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.body = result.data;
  return next();
};

module.exports = {
  createSlotsBodySchema,
  updateSlotBodySchema,
  listSlotsQuerySchema,
  listSessionsQuerySchema,
  createSessionBodySchema,
  patchSessionBodySchema,
  cancelSessionBodySchema,
  validateListSlotsQuery,
  validateCreateSlotsBody,
  validateUpdateSlotBody,
  validateListSessionsQuery,
  validateCreateSessionBody,
  validatePatchSessionBody,
  validateCancelSessionBody,
};
