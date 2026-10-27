const z = require('zod');
const {
  PlanKind,
  PlanBillingCycle,
  PlanCreditType,
  PlanCreditRefill,
  PlanValidityUnit,
  PlanStartsOn,
  PlanVisibility,
  PlanStatus,
  PlanSection,
  PLAN_EDITABLE_FIELDS,
  PLAN_NON_EDITABLE_FIELDS,
  PLAN_STATUS_REASON_MAX_LENGTH,
  PLAN_SORT_FIELDS,
  PLAN_DEFAULT_SORT,
  PLAN_SEARCH_MAX_LENGTH,
  PLAN_NAME_MIN_LENGTH,
  PLAN_NAME_MAX_LENGTH,
  PLAN_PRICE_MIN,
  PLAN_PRICE_MAX,
  PLAN_DESCRIPTION_MAX_LENGTH,
} = require('../constants/membershipPlan');
const { Messages } = require('../constants/messages');
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../constants/pagination');

const { parseSort } = require('../utils/sort.util');
const { sendValidationFailed } = require('../utils/validationError.util');
const { toEditableFields } = require('../repositories/membershipPlan.mapper');
const { pageField, buildSizeField } = require('./pagination.validation');

const RECURRING_CYCLES = new Set([
  PlanBillingCycle.MONTH,
  PlanBillingCycle.QUARTER,
  PlanBillingCycle.HALF_YEAR,
  PlanBillingCycle.YEAR,
]);

const priceField = z
  .preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return undefined;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : val;
    }
    return val;
  }, z.any())
  .superRefine((val, ctx) => {
    if (val === undefined || val === null || val === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: Messages.PLAN_PRICE_REQUIRED,
      });
      return;
    }
    if (typeof val !== 'number' || !Number.isFinite(val) || val < PLAN_PRICE_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: Messages.PLAN_PRICE_REQUIRED,
      });
      return;
    }
    if (val > PLAN_PRICE_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Price must not exceed ${PLAN_PRICE_MAX}`,
      });
    }
  });

const toUpperEnum = (enumObj) =>
  z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
    z.enum(Object.values(enumObj)),
  );

const toUpperEnumOptional = (enumObj) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === '') return null;
      return typeof val === 'string' ? val.trim().toUpperCase() : val;
    },
    z.enum(Object.values(enumObj)).nullable().optional(),
  );

const membershipPlanSchema = z
  .object({
    name: z.string().trim().min(PLAN_NAME_MIN_LENGTH).max(PLAN_NAME_MAX_LENGTH),
    kind: toUpperEnum(PlanKind),
    price: priceField,
    billingCycle: toUpperEnum(PlanBillingCycle),
    creditType: toUpperEnum(PlanCreditType),
    creditsIncluded: z.preprocess(
      (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
      z.number().int().optional(),
    ),
    creditRefill: toUpperEnumOptional(PlanCreditRefill),
    validityValue: z.number().int().min(1),
    validityUnit: toUpperEnum(PlanValidityUnit),
    startsOn: toUpperEnum(PlanStartsOn),
    oneTimePurchasePerClient: z.boolean().default(false),
    visibility: toUpperEnum(PlanVisibility),
    status: toUpperEnum(PlanStatus).default(PlanStatus.ACTIVE),
    description: z.string().trim().max(PLAN_DESCRIPTION_MAX_LENGTH).nullable().optional(),
    externalRef: z.string().trim().nullable().optional(),
    term: z.string().trim().max(100).nullable().optional(),
    recurring: z.boolean().default(false),
    periodMonths: z
      .preprocess(
        (val) => (val === null || val === undefined || val === '' ? null : Number(val)),
        z
          .number()
          .int()
          .refine((val) => [1, 3, 6, 12].includes(val), {
            message: 'periodMonths must be 1, 3, 6, or 12',
          })
          .nullable()
          .optional(),
      ),
    joiningFee: z
      .preprocess(
        (val) => (val === undefined || val === null || val === '' ? 0 : Number(val)),
        z.number().min(0).default(0),
      ),
    membershipId: z
      .preprocess(
        (val) => (val === '' ? null : val),
        z.string().uuid({ message: 'membershipId must be a valid UUID' }).nullable().optional(),
      ),
    membership: z
      .object({
        name: z.string().trim().min(1, Messages.MEMBERSHIP_NAME_REQUIRED).max(80),
        description: z.string().trim().max(500).nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    // 1. Time plans must have 0 credits or omitted (defaults to 0)
    if (data.creditType === PlanCreditType.TIME) {
      if (data.creditsIncluded !== undefined && data.creditsIncluded !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'creditsIncluded must be 0 when creditType is TIME',
          path: ['creditsIncluded'],
        });
      }
      if (data.creditRefill !== null && data.creditRefill !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'creditRefill must be null when creditType is TIME',
          path: ['creditRefill'],
        });
      }
    } else {
      // 2. Non-time plans must have >= 1 credits and whole number
      if (
        data.creditsIncluded === undefined ||
        data.creditsIncluded < 1 ||
        !Number.isInteger(data.creditsIncluded)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'creditsIncluded must be at least 1 when creditType is not TIME',
          path: ['creditsIncluded'],
        });
      }
    }

    // 3. creditRefill = MONTHLY is only valid when billingCycle is MONTH
    if (
      data.creditRefill === PlanCreditRefill.MONTHLY &&
      data.billingCycle !== PlanBillingCycle.MONTH
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'creditRefill can only be MONTHLY when billingCycle is MONTH',
        path: ['creditRefill'],
      });
    }

    // 4. Only SUBSCRIPTION may use recurring billingCycle
    if (RECURRING_CYCLES.has(data.billingCycle) && data.kind !== PlanKind.SUBSCRIPTION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: Messages.PLAN_RENEW_SUBSCRIPTION_ONLY,
        path: ['billingCycle'],
      });
    }

    // 5. Mutual exclusivity: membershipId OR membership { name, description }
    const hasMembershipId = Boolean(data.membershipId);
    const hasNewMembership = Boolean(
      data.membership &&
        typeof data.membership === 'object' &&
        data.membership.name &&
        data.membership.name.trim(),
    );
    if (hasMembershipId && hasNewMembership) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'membershipId and membership are mutually exclusive',
        path: ['membershipId'],
      });
    }
  });

// createPlanSchema builds on membershipPlanSchema:
// - strips externalRef silently
// - defaults creditsIncluded to 0 for TIME plans
// - forces status to ACTIVE
const createPlanSchema = membershipPlanSchema.transform((data) => {
  const creditsIncluded =
    data.creditType === PlanCreditType.TIME ? (data.creditsIncluded ?? 0) : data.creditsIncluded;
  return {
    ...data,
    creditsIncluded,
    status: PlanStatus.ACTIVE,
  };
});

// Blank query values ("?section=") count as "not given", so web forms can send empty filters.
const blankToUndefined = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// Query enums are matched case-insensitively. `toCase` gives the form the database uses.
const queryEnum = (enumObj, message, toCase) =>
  z
    .preprocess(
      (value) => {
        const given = blankToUndefined(value);
        return typeof given === 'string' ? given.trim().toLowerCase() : given;
      },
      z
        .enum(
          Object.values(enumObj).map((v) => v.toLowerCase()),
          { error: message },
        )
        .optional(),
    )
    .transform((value) => (value === undefined ? value : toCase(value)));

const toUpper = (value) => value.toUpperCase();

const STATUS_QUERY_VALUES = new Set(Object.values(PlanStatus).map((v) => v.toLowerCase()));

// "active,inactive" (or a repeated param) becomes a de-duplicated list of database values.
const statusListField = z
  .preprocess(
    (value) => {
      if (blankToUndefined(value) === undefined) return undefined;
      return [value]
        .flat()
        .flatMap((part) => String(part).split(','))
        .map((part) => part.trim().toLowerCase());
    },
    z
      .array(z.string(), { error: Messages.PLAN_STATUS_INVALID })
      .min(1, Messages.PLAN_STATUS_INVALID)
      .refine(
        (list) => list.every((item) => STATUS_QUERY_VALUES.has(item)),
        Messages.PLAN_STATUS_INVALID,
      )
      .optional(),
  )
  .transform((list) => (list === undefined ? list : [...new Set(list.map(toUpper))]));

const sortField = z
  .string({ error: Messages.PLAN_SORT_INVALID })
  .trim()
  .default(PLAN_DEFAULT_SORT)
  .transform((value, ctx) => {
    const sort = parseSort(value, PLAN_SORT_FIELDS, PLAN_DEFAULT_SORT);
    if (!sort) {
      ctx.addIssue({ code: 'custom', message: Messages.PLAN_SORT_INVALID });
      return z.NEVER;
    }
    return sort;
  });

// Unknown query params are dropped (not rejected) so web and mobile clients can add params
// without breaking; a known param with a bad value is still a validation error.
const listPlansQuerySchema = z.object({
  section: queryEnum(PlanSection, Messages.PLAN_SECTION_INVALID, (value) => value),
  kind: queryEnum(PlanKind, Messages.PLAN_KIND_INVALID, toUpper),
  creditType: queryEnum(PlanCreditType, Messages.PLAN_CREDIT_TYPE_INVALID, toUpper),
  visibility: queryEnum(PlanVisibility, Messages.PLAN_VISIBILITY_INVALID, toUpper),
  status: statusListField,
  q: z
    .string({ error: Messages.PLAN_SEARCH_INVALID })
    .trim()
    .max(PLAN_SEARCH_MAX_LENGTH, Messages.PLAN_SEARCH_INVALID)
    .transform((value) => value || undefined)
    .optional(),
  page: pageField,
  pageSize: buildSizeField({
    message: Messages.PAGE_SIZE_INVALID,
    max: MAX_PAGE_SIZE,
    defaultValue: DEFAULT_PAGE_SIZE,
  }),
  sort: sortField,
});

const validateListPlansQuery = (req, res, next) => {
  const result = listPlansQuerySchema.safeParse(req.query);
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedQuery = result.data;
  return next();
};

// A key that cannot be edited, or that is not a plan field, is rejected rather than ignored.
const findBadPatchKeys = (body) => {
  const keys = Object.keys(body);
  if (keys.length === 0) return [{ path: [], message: Messages.PLAN_UPDATE_EMPTY }];
  return keys.flatMap((key) => {
    if (key === 'status') {
      return [{ path: [key], message: Messages.PLAN_STATUS_USE_STATUS_ENDPOINT }];
    }
    if (PLAN_NON_EDITABLE_FIELDS.includes(key)) {
      return [{ path: [key], message: Messages.PLAN_FIELD_NOT_EDITABLE }];
    }
    if (!PLAN_EDITABLE_FIELDS.includes(key)) {
      return [{ path: [key], message: Messages.PLAN_FIELD_UNKNOWN }];
    }
    return [];
  });
};

// Needs req.plan (run `loadPlan` first). The sent fields are laid over the stored plan and the
// RESULT goes through the same rules as a create, so a partial update cannot leave an invalid
// plan. req.validatedBody is the full validated set of editable fields.
const validateUpdatePlanBody = (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

  const badKeys = findBadPatchKeys(body);
  if (badKeys.length > 0) return sendValidationFailed(res, { issues: badKeys });

  const result = membershipPlanSchema.safeParse({ ...toEditableFields(req.plan), ...body });
  if (!result.success) return sendValidationFailed(res, result.error);

  req.validatedBody = toEditableFields(result.data);
  return next();
};

const planStatusBodySchema = z
  .object({
    status: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(
          Object.values(PlanStatus).map((v) => v.toLowerCase()),
          { error: Messages.PLAN_STATUS_VALUE_INVALID },
        ),
      )
      .transform(toUpper),
    reason: z
      .string({ error: Messages.PLAN_STATUS_REASON_INVALID })
      .trim()
      .max(PLAN_STATUS_REASON_MAX_LENGTH, Messages.PLAN_STATUS_REASON_INVALID)
      .transform((value) => value || undefined)
      .optional(),
  })
  .strict();

const validatePlanStatusBody = (req, res, next) => {
  const result = planStatusBodySchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

const validateCreatePlan = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    // Strip externalRef silently as per ticket spec
    if ('externalRef' in req.body) {
      delete req.body.externalRef;
    }
    // Never persist memMode/newMemName/newMemDesc
    delete req.body.memMode;
    delete req.body.newMemName;
    delete req.body.newMemDesc;
    // Force status to ACTIVE
    req.body.status = PlanStatus.ACTIVE;
  }

  const result = createPlanSchema.safeParse(req.body);
  if (!result.success) return sendValidationFailed(res, result.error);

  req.body = result.data;
  return next();
};

module.exports = {
  membershipPlanSchema,
  createPlanSchema,
  listPlansQuerySchema,
  planStatusBodySchema,
  validateCreatePlan,
  validateListPlansQuery,
  validateUpdatePlanBody,
  validatePlanStatusBody,
};
