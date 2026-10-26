const z = require('zod');
const {
  ClassVisibility,
  ClassStatus,
  ClassType,
  INTENSITY_MIN,
  INTENSITY_MAX,
  CLASS_NAME_MIN_LENGTH,
  CLASS_NAME_MAX_LENGTH,
  CLASS_DESCRIPTION_MAX_LENGTH,
  CLASS_DURATION_MIN,
  CLASS_DURATION_MAX,
  CLASS_BASE_CAPACITY_MIN,
  CLASS_BASE_CAPACITY_MAX,
  CLASS_CLASSPASS_SPOTS_MIN,
  CLASS_COLOUR_REGEX,
  CLASS_PHOTO_URL_MAX_LENGTH,
  CLASS_DEFAULT_PAGE_SIZE,
  CLASS_MAX_PAGE_SIZE,
  CLASS_EDITABLE_FIELDS,
} = require('../constants/class');
const { Messages } = require('../constants/messages');
const { sendValidationFailed } = require('../utils/validationError.util');
const { pageField, buildSizeField } = require('./pagination.validation');

const toUpperEnum = (enumObj, errorMsg) =>
  z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
    z.enum(Object.values(enumObj), { error: errorMsg }),
  );

const createClassSchema = z
  .object({
    name: z
      .string({ error: Messages.CLASS_NAME_REQUIRED })
      .trim()
      .min(CLASS_NAME_MIN_LENGTH, Messages.CLASS_NAME_INVALID)
      .max(CLASS_NAME_MAX_LENGTH, Messages.CLASS_NAME_INVALID),
    description: z.preprocess(
      (val) => (val === '' ? null : val),
      z
        .string({ error: Messages.CLASS_DESCRIPTION_MAX })
        .max(CLASS_DESCRIPTION_MAX_LENGTH, Messages.CLASS_DESCRIPTION_MAX)
        .nullable()
        .optional(),
    ),
    durationMin: z
      .number({ error: Messages.CLASS_DURATION_INVALID })
      .int(Messages.CLASS_DURATION_INVALID)
      .min(CLASS_DURATION_MIN, Messages.CLASS_DURATION_INVALID)
      .max(CLASS_DURATION_MAX, Messages.CLASS_DURATION_INVALID),
    classType: toUpperEnum(ClassType, Messages.CLASS_TYPE_INVALID).default(ClassType.ONSITE),
    baseCapacity: z
      .number({ error: Messages.CLASS_BASE_CAPACITY_INVALID })
      .int(Messages.CLASS_BASE_CAPACITY_INVALID)
      .min(CLASS_BASE_CAPACITY_MIN, Messages.CLASS_BASE_CAPACITY_INVALID)
      .max(CLASS_BASE_CAPACITY_MAX, Messages.CLASS_BASE_CAPACITY_INVALID),
    intensity: z
      .number({ error: Messages.CLASS_INTENSITY_INVALID })
      .int(Messages.CLASS_INTENSITY_INVALID)
      .min(INTENSITY_MIN, Messages.CLASS_INTENSITY_INVALID)
      .max(INTENSITY_MAX, Messages.CLASS_INTENSITY_INVALID),
    visibility: toUpperEnum(ClassVisibility, Messages.CLASS_VISIBILITY_INVALID),
    classPassEnabled: z.boolean({ error: Messages.CLASS_CLASSPASS_ENABLED_REQUIRED }).default(false),
    classpassSpots: z
      .preprocess(
        (val) => (val === undefined || val === null ? 0 : val),
        z
          .number({ error: Messages.CLASS_CLASSPASS_SPOTS_INVALID })
          .int(Messages.CLASS_CLASSPASS_SPOTS_INVALID)
          .min(CLASS_CLASSPASS_SPOTS_MIN, Messages.CLASS_CLASSPASS_SPOTS_INVALID),
      )
      .optional(),
    colour: z.preprocess(
      (val) => (val === '' || val === null ? null : val),
      z
        .string({ error: Messages.CLASS_COLOUR_INVALID })
        .regex(CLASS_COLOUR_REGEX, Messages.CLASS_COLOUR_INVALID)
        .nullable()
        .optional(),
    ),
    photoUrl: z.preprocess(
      (val) => (val === '' || val === null ? null : val),
      z
        .string({ error: Messages.CLASS_PHOTO_URL_INVALID })
        .max(CLASS_PHOTO_URL_MAX_LENGTH, Messages.CLASS_PHOTO_URL_INVALID)
        .url(Messages.CLASS_PHOTO_URL_INVALID)
        .refine((url) => typeof url === 'string' && url.startsWith('https://'), {
          message: Messages.CLASS_PHOTO_URL_INVALID,
        })
        .nullable()
        .optional(),
    ),
    coachIds: z
      .array(z.string().uuid({ message: Messages.CLASS_COACH_NOT_FOUND }))
      .optional(),
    eligiblePlanIds: z
      .array(z.string().uuid({ message: Messages.CLASS_PLAN_NOT_FOUND }))
      .optional(),
  })
  .superRefine((data, ctx) => {
    const classpass = data.classpassSpots ?? 0;
    if (!data.classPassEnabled && classpass > 0) {
      ctx.addIssue({
        path: ['classpassSpots'],
        message: Messages.CLASS_CLASSPASS_DISABLED_SPOTS_MUST_BE_ZERO,
        code: z.ZodIssueCode.custom,
      });
    }

    if (classpass > data.baseCapacity) {
      ctx.addIssue({
        path: ['classpassSpots'],
        message: Messages.CLASS_CLASSPASS_SPOTS_INVALID,
        code: z.ZodIssueCode.custom,
      });
    }

    if (data.visibility === ClassVisibility.PUBLIC) {
      if (!data.eligiblePlanIds || data.eligiblePlanIds.length === 0) {
        ctx.addIssue({
          path: ['eligiblePlanIds'],
          message: Messages.CLASS_PUBLIC_REQUIRES_PLANS,
          code: z.ZodIssueCode.custom,
        });
      }
    }
  });

const validateCreateClass = (req, res, next) => {
  const result = createClassSchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const findBadPatchKeys = (body) => {
  const keys = Object.keys(body);
  if (keys.length === 0) return [{ path: [], message: Messages.CLASS_UPDATE_EMPTY }];

  return keys.flatMap((key) => {
    if (key === 'eligiblePlanIds') {
      return [{ path: [key], message: Messages.CLASS_ELIGIBILITY_USE_ENDPOINT }];
    }
    if (key === 'active' || key === 'status') {
      return [{ path: [key], message: Messages.CLASS_DEACTIVATE_USE_ENDPOINT }];
    }
    if (key === 'version') {
      return []; // version is allowed for optimistic locking
    }
    if (key === 'id' || key === 'externalRef' || key === 'createdAt' || key === 'updatedAt') {
      return [{ path: [key], message: Messages.CLASS_FIELD_NOT_EDITABLE }];
    }
    if (!CLASS_EDITABLE_FIELDS.includes(key)) {
      return [{ path: [key], message: Messages.CLASS_FIELD_NOT_EDITABLE }];
    }
    return [];
  });
};

const patchFieldsSchema = z.object({
  name: z
    .string({ error: Messages.CLASS_NAME_REQUIRED })
    .trim()
    .min(CLASS_NAME_MIN_LENGTH, Messages.CLASS_NAME_INVALID)
    .max(CLASS_NAME_MAX_LENGTH, Messages.CLASS_NAME_INVALID)
    .optional(),
  description: z.preprocess(
    (val) => (val === '' ? null : val),
    z
      .string({ error: Messages.CLASS_DESCRIPTION_MAX })
      .max(CLASS_DESCRIPTION_MAX_LENGTH, Messages.CLASS_DESCRIPTION_MAX)
      .nullable()
      .optional(),
  ),
  durationMin: z
    .number({ error: Messages.CLASS_DURATION_INVALID })
    .int(Messages.CLASS_DURATION_INVALID)
    .min(CLASS_DURATION_MIN, Messages.CLASS_DURATION_INVALID)
    .max(CLASS_DURATION_MAX, Messages.CLASS_DURATION_INVALID)
    .optional(),
  classType: toUpperEnum(ClassType, Messages.CLASS_TYPE_INVALID).optional(),
  baseCapacity: z
    .number({ error: Messages.CLASS_BASE_CAPACITY_INVALID })
    .int(Messages.CLASS_BASE_CAPACITY_INVALID)
    .min(CLASS_BASE_CAPACITY_MIN, Messages.CLASS_BASE_CAPACITY_INVALID)
    .max(CLASS_BASE_CAPACITY_MAX, Messages.CLASS_BASE_CAPACITY_INVALID)
    .optional(),
  intensity: z
    .number({ error: Messages.CLASS_INTENSITY_INVALID })
    .int(Messages.CLASS_INTENSITY_INVALID)
    .min(INTENSITY_MIN, Messages.CLASS_INTENSITY_INVALID)
    .max(INTENSITY_MAX, Messages.CLASS_INTENSITY_INVALID)
    .optional(),
  visibility: toUpperEnum(ClassVisibility, Messages.CLASS_VISIBILITY_INVALID).optional(),
  classPassEnabled: z.boolean({ error: Messages.CLASS_CLASSPASS_ENABLED_REQUIRED }).optional(),
  classpassSpots: z
    .number({ error: Messages.CLASS_CLASSPASS_SPOTS_INVALID })
    .int(Messages.CLASS_CLASSPASS_SPOTS_INVALID)
    .min(CLASS_CLASSPASS_SPOTS_MIN, Messages.CLASS_CLASSPASS_SPOTS_INVALID)
    .optional(),
  colour: z.preprocess(
    (val) => (val === '' || val === null ? null : val),
    z
      .string({ error: Messages.CLASS_COLOUR_INVALID })
      .regex(CLASS_COLOUR_REGEX, Messages.CLASS_COLOUR_INVALID)
      .nullable()
      .optional(),
  ),
  photoUrl: z.preprocess(
    (val) => (val === '' || val === null ? null : val),
    z
      .string({ error: Messages.CLASS_PHOTO_URL_INVALID })
      .max(CLASS_PHOTO_URL_MAX_LENGTH, Messages.CLASS_PHOTO_URL_INVALID)
      .url(Messages.CLASS_PHOTO_URL_INVALID)
      .refine((url) => typeof url === 'string' && url.startsWith('https://'), {
        message: Messages.CLASS_PHOTO_URL_INVALID,
      })
      .nullable()
      .optional(),
  ),
  coachIds: z
    .array(z.string().uuid({ message: Messages.CLASS_COACH_NOT_FOUND }))
    .optional(),
  version: z.number().int().min(1).optional(),
});

const validateUpdateClassBody = (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

  const badKeys = findBadPatchKeys(body);
  if (badKeys.length > 0) return sendValidationFailed(res, { issues: badKeys });

  // intensity rule: if explicit null or 0 was passed in body -> 422
  if ('intensity' in body && (body.intensity === null || body.intensity === 0)) {
    return sendValidationFailed(res, {
      issues: [{ path: ['intensity'], message: Messages.CLASS_INTENSITY_INVALID }],
    });
  }

  const parseResult = patchFieldsSchema.safeParse(body);
  if (!parseResult.success) return sendValidationFailed(res, parseResult.error);

  const parsed = parseResult.data;
  const current = req.class;

  // Merged state validation
  const mergedBaseCapacity =
    parsed.baseCapacity !== undefined ? parsed.baseCapacity : current.baseCapacity;
  const mergedClassPassEnabled =
    parsed.classPassEnabled !== undefined ? parsed.classPassEnabled : current.classPassEnabled;
  const mergedClasspassSpots =
    parsed.classpassSpots !== undefined ? parsed.classpassSpots : current.classpassSpots;

  if (!mergedClassPassEnabled && mergedClasspassSpots > 0) {
    return sendValidationFailed(res, {
      issues: [
        {
          path: ['classpassSpots'],
          message: Messages.CLASS_CLASSPASS_DISABLED_SPOTS_MUST_BE_ZERO,
        },
      ],
    });
  }

  if (mergedClasspassSpots > mergedBaseCapacity) {
    return sendValidationFailed(res, {
      issues: [
        {
          path: ['classpassSpots'],
          message: Messages.CLASS_CLASSPASS_SPOTS_INVALID,
        },
      ],
    });
  }

  // private -> public with 0 plans rule
  const nextVisibility = parsed.visibility !== undefined ? parsed.visibility : current.visibility;
  const currentPlanCount = Array.isArray(current.eligiblePlans) ? current.eligiblePlans.length : 0;
  if (current.visibility === ClassVisibility.PRIVATE && nextVisibility === ClassVisibility.PUBLIC) {
    if (currentPlanCount === 0) {
      return sendValidationFailed(res, {
        issues: [
          {
            path: ['visibility'],
            message: Messages.CLASS_PUBLIC_REQUIRES_PLANS,
          },
        ],
      });
    }
  }

  req.validatedBody = parsed;
  return next();
};

const classEligibilitySchema = z.object({
  planIds: z.array(z.string().uuid({ message: Messages.CLASS_PLAN_NOT_FOUND }), {
    error: Messages.CLASS_PLAN_NOT_FOUND,
  }),
});

const validateClassEligibility = (req, res, next) => {
  const result = classEligibilitySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const listClassesQuerySchema = z.object({
  visibility: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['public', 'private']).optional(),
  ),
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['active', 'deactivated', 'archived', 'all'], {
      error: Messages.CLASS_STATUS_INVALID,
    }).optional(),
  ),
  active: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false', 'all']).optional(),
  ),
  classType: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['onsite', 'online']).optional(),
  ),
  search: z.string().trim().optional(),
  page: pageField,
  pageSize: buildSizeField({
    message: 'Page size must be a whole number between 1 and 100',
    max: CLASS_MAX_PAGE_SIZE,
    defaultValue: CLASS_DEFAULT_PAGE_SIZE,
  }),
});

const validateListClassesQuery = (req, res, next) => {
  const result = listClassesQuerySchema.safeParse(req.query ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

module.exports = {
  createClassSchema,
  patchFieldsSchema,
  classEligibilitySchema,
  listClassesQuerySchema,
  validateCreateClass,
  validateUpdateClassBody,
  validateClassEligibility,
  validateListClassesQuery,
};
