const z = require('zod');
const { sendValidationFailed } = require('../utils/validationError.util');
const { pageField, buildSizeField } = require('./pagination.validation');
const {
  SESSION_CAPACITY_MIN,
  SESSION_CAPACITY_MAX,
} = require('../constants/session');

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
      .string({ error: 'startTime is required' })
      .regex(TIME_REGEX, 'startTime must be in HH:mm format (00:00 to 23:59)'),
    endTime: z
      .string({ error: 'endTime is required' })
      .regex(TIME_REGEX, 'endTime must be in HH:mm format (00:00 to 23:59)'),
    coachIds: z
      .array(z.string().regex(UUID_REGEX, 'Each coachId must be a valid UUID'))
      .optional()
      .default([]),
    capacity: z
      .number()
      .int('capacity must be an integer')
      .min(SESSION_CAPACITY_MIN, `capacity must be at least ${SESSION_CAPACITY_MIN}`)
      .max(SESSION_CAPACITY_MAX, `capacity must be at most ${SESSION_CAPACITY_MAX}`)
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be later than startTime',
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: 'coachIds cannot contain duplicate IDs',
        });
      }
    }
  });

const slotDayEntrySchema = z
  .object({
    dayOfWeek: z
      .number({ error: 'dayOfWeek is required' })
      .int('dayOfWeek must be an integer')
      .min(1, 'dayOfWeek must be between 1 (Monday) and 7 (Sunday)')
      .max(7, 'dayOfWeek must be between 1 (Monday) and 7 (Sunday)'),
    times: z
      .array(slotTimeEntrySchema)
      .min(1, 'times array must contain at least one time entry'),
  })
  .superRefine((data, ctx) => {
    const startTimes = new Set();
    data.times.forEach((t, idx) => {
      if (startTimes.has(t.startTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['times', idx, 'startTime'],
          message: `Duplicate startTime '${t.startTime}' on dayOfWeek ${data.dayOfWeek}`,
        });
      }
      startTimes.add(t.startTime);
    });
  });

const createSlotsBodySchema = z
  .object({
    startDate: z
      .string({ error: 'startDate is required' })
      .refine(isValidDateString, 'startDate must be a valid calendar date in YYYY-MM-DD format'),
    days: z
      .array(slotDayEntrySchema)
      .min(1, 'days array must contain at least one day entry')
      .max(7, 'days array cannot contain more than 7 entries'),
  })
  .superRefine((data, ctx) => {
    const daysSeen = new Set();
    data.days.forEach((d, idx) => {
      if (daysSeen.has(d.dayOfWeek)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', idx, 'dayOfWeek'],
          message: `Duplicate dayOfWeek '${d.dayOfWeek}' in request body`,
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
      .min(1, 'dayOfWeek must be between 1 and 7')
      .max(7, 'dayOfWeek must be between 1 and 7')
      .optional(),
    startDate: z
      .string()
      .refine(isValidDateString, 'startDate must be a valid calendar date in YYYY-MM-DD format')
      .optional(),
    startTime: z.string().regex(TIME_REGEX, 'startTime must be in HH:mm format').optional(),
    endTime: z.string().regex(TIME_REGEX, 'endTime must be in HH:mm format').optional(),
    capacity: z
      .number()
      .int()
      .min(SESSION_CAPACITY_MIN)
      .max(SESSION_CAPACITY_MAX)
      .nullable()
      .optional(),
    coachIds: z
      .array(z.string().regex(UUID_REGEX, 'Each coachId must be a valid UUID'))
      .optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'Provide at least one field to update',
      });
    }
    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be later than startTime',
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: 'coachIds cannot contain duplicate IDs',
        });
      }
    }
  });

const listSlotsQuerySchema = z.object({
  includeInactive: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']))
    .optional(),
});

// ==========================================
// Session Validation Schemas
// ==========================================

const listSessionsQuerySchema = z
  .object({
    from: z
      .string({ error: 'from query parameter is required' })
      .refine(isValidIsoDateTime, 'from must be a valid ISO-8601 date string'),
    to: z
      .string({ error: 'to query parameter is required' })
      .refine(isValidIsoDateTime, 'to must be a valid ISO-8601 date string'),
    classId: z.string().regex(UUID_REGEX, 'classId must be a valid UUID').optional(),
    coachId: z.string().regex(UUID_REGEX, 'coachId must be a valid UUID').optional(),
    state: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['open', 'full', 'cancelled']))
      .optional(),
    isPrivate: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v), z.boolean())
      .optional(),
    page: pageField,
    pageSize: buildSizeField({
      message: 'Page size must be a whole number between 1 and 100',
      max: 100,
      defaultValue: 100,
    }),
  })
  .superRefine((data, ctx) => {
    const fromDate = new Date(data.from);
    const toDate = new Date(data.to);

    if (toDate < fromDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to date must be greater than or equal to from date',
      });
    }

    const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 92) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'The date range between from and to cannot exceed 92 days',
      });
    }
  });

const createSessionBodySchema = z
  .object({
    classId: z
      .string({ error: 'classId is required' })
      .regex(UUID_REGEX, 'classId must be a valid UUID'),
    startAt: z
      .string({ error: 'startAt is required' })
      .refine(isValidIsoDateTime, 'startAt must be a valid ISO-8601 date string'),
    endAt: z
      .string({ error: 'endAt is required' })
      .refine(isValidIsoDateTime, 'endAt must be a valid ISO-8601 date string'),
    durationMin: z
      .number()
      .int('durationMin must be an integer')
      .min(15, 'durationMin must be at least 15')
      .max(240, 'durationMin must be at most 240')
      .optional(),
    coachIds: z
      .array(z.string().regex(UUID_REGEX, 'Each coachId must be a valid UUID'))
      .optional(),
    capacity: z
      .number()
      .int('capacity must be an integer')
      .min(SESSION_CAPACITY_MIN, `capacity must be at least ${SESSION_CAPACITY_MIN}`)
      .max(SESSION_CAPACITY_MAX, `capacity must be at most ${SESSION_CAPACITY_MAX}`)
      .nullable()
      .optional(),
    intensity: z.number().int().min(1).max(5).optional(),
    classType: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['onsite', 'online']))
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
        message: 'endAt must be later than startAt',
      });
    }
    if (Array.isArray(data.coachIds)) {
      const uniqueCoaches = new Set(data.coachIds);
      if (uniqueCoaches.size !== data.coachIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coachIds'],
          message: 'coachIds cannot contain duplicate IDs',
        });
      }
    }
  });

const patchSessionBodySchema = z
  .object({
    capacity: z
      .number()
      .int()
      .min(SESSION_CAPACITY_MIN)
      .max(SESSION_CAPACITY_MAX)
      .optional(),
    startAt: z
      .string()
      .refine(isValidIsoDateTime, 'startAt must be a valid ISO-8601 date string')
      .optional(),
    endAt: z
      .string()
      .refine(isValidIsoDateTime, 'endAt must be a valid ISO-8601 date string')
      .optional(),
    durationMin: z.number().int().min(15).max(240).optional(),
    coachIds: z
      .array(z.string().regex(UUID_REGEX, 'Each coachId must be a valid UUID'))
      .optional(),
    intensity: z.number().int().min(1).max(5).optional(),
    classType: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['onsite', 'online']))
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
        message: 'Provide at least one field to update',
      });
    }
    if (data.startAt && data.endAt) {
      const start = new Date(data.startAt);
      const end = new Date(data.endAt);
      if (end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: 'endAt must be later than startAt',
        });
      }
    }
  });

const cancelSessionBodySchema = z.object({
  reason: z
    .string({ error: 'reason is required' })
    .trim()
    .min(1, 'Cancellation reason cannot be empty')
    .max(500, 'Cancellation reason must be at most 500 characters'),
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
