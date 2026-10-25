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
  PLAN_NAME_MIN_LENGTH,
  PLAN_NAME_MAX_LENGTH,
  PLAN_PRICE_MIN,
  PLAN_PRICE_MAX,
  PLAN_DESCRIPTION_MAX_LENGTH,
} = require('../constants/membershipPlan');
const { Messages } = require('../constants/messages');
const { AppErrors } = require('../constants/errors');

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

const validateCreatePlan = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    // Strip externalRef silently as per ticket spec
    if ('externalRef' in req.body) {
      delete req.body.externalRef;
    }
    // Force status to ACTIVE
    req.body.status = PlanStatus.ACTIVE;
  }

  const result = createPlanSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      message: Messages.VALIDATION_FAILED,
      code: AppErrors.VALIDATION_ERROR.code,
      errors,
    });
  }

  req.body = result.data;
  return next();
};

module.exports = {
  membershipPlanSchema,
  createPlanSchema,
  validateCreatePlan,
};
