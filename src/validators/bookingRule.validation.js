const z = require('zod');
const { Messages } = require('../constants/messages');
const {
  BookingRuleKey,
  BookingRuleUnit,
  BookingRuleValueType,
  UNIT_BOUNDS,
  findCatalogueEntry,
  valueTypeOf,
} = require('../constants/bookingRule');
const { sendValidationFailed } = require('../utils/validationError.util');

// Registry (strategy per value type): each function returns an error message, or null when the
// value fits. A new value type is one new entry here.
const isWholeNumber = (value) => typeof value === 'number' && Number.isInteger(value);

const checkInteger = (value, unit) => {
  if (!isWholeNumber(value)) return Messages.BOOKING_RULE_VALUE_NOT_WHOLE;
  const { min, max } = UNIT_BOUNDS[unit];
  return value < min || value > max
    ? Messages.BOOKING_RULE_VALUE_OUT_OF_RANGE(min, max, unit)
    : null;
};

const checkPercent = (value) => {
  const { min, max } = UNIT_BOUNDS[BookingRuleUnit.PERCENT];
  if (!isWholeNumber(value) || value < min || value > max) {
    return Messages.BOOKING_RULE_PERCENT_OUT_OF_RANGE(min, max);
  }
  return null;
};

// A flag is only on or off, so it never carries a value.
const checkFlag = () => Messages.BOOKING_RULE_FLAG_HAS_NO_VALUE;

const VALUE_CHECKS = Object.freeze({
  [BookingRuleValueType.INTEGER]: checkInteger,
  [BookingRuleValueType.PERCENT]: checkPercent,
  [BookingRuleValueType.FLAG]: checkFlag,
});

// Message for a value sent for a rule with this unit (null unit = flag rule), or null if valid.
const findValueProblem = (value, unit) => VALUE_CHECKS[valueTypeOf(unit)](value, unit);

// Strict: any key besides the ones listed is a 400, so name, category or unit can never be sent.
const strictBody = (shape) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? Messages.BOOKING_RULE_FIELD_UNKNOWN : undefined,
  });

const enabledField = z.boolean({ error: Messages.BOOKING_RULE_ENABLED_INVALID }).optional();

const bookingRuleIdParamSchema = z.object({
  id: z.uuid({ error: Messages.BOOKING_RULE_ID_INVALID }),
});

// The value is checked against the unit of the rule named by ruleKey.
const createBookingRuleSchema = strictBody({
  ruleKey: z.enum(Object.values(BookingRuleKey), { error: Messages.BOOKING_RULE_KEY_INVALID }),
  value: z.unknown().optional(),
  enabled: enabledField,
}).superRefine((data, ctx) => {
  const entry = findCatalogueEntry(data.ruleKey);
  if (!entry || data.value === undefined) return;
  const problem = findValueProblem(data.value, entry.unit);
  if (problem) ctx.addIssue({ code: 'custom', path: ['value'], message: problem });
});

// The value is checked against the stored rule in the service, which knows its unit.
const updateBookingRuleSchema = strictBody({
  value: z.unknown().optional(),
  enabled: enabledField,
}).refine((data) => data.value !== undefined || data.enabled !== undefined, {
  message: Messages.BOOKING_RULE_UPDATE_EMPTY,
});

// unrecognized_keys has an empty path; report one error per offending key instead.
const expandIssues = (error) => ({
  issues: error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: [key], message: issue.message }))
      : [issue],
  ),
});

const validateWith = (schema, source, target) => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) return sendValidationFailed(res, expandIssues(result.error));
  req[target] = result.data;
  return next();
};

const validateBookingRuleIdParam = validateWith(
  bookingRuleIdParamSchema,
  'params',
  'validatedParams',
);
const validateCreateBookingRule = validateWith(createBookingRuleSchema, 'body', 'validatedBody');
const validateUpdateBookingRule = validateWith(updateBookingRuleSchema, 'body', 'validatedBody');

module.exports = {
  findValueProblem,
  bookingRuleIdParamSchema,
  createBookingRuleSchema,
  updateBookingRuleSchema,
  validateBookingRuleIdParam,
  validateCreateBookingRule,
  validateUpdateBookingRule,
};
