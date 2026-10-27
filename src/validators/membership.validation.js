const z = require('zod');
const { Messages } = require('../constants/messages');
const { sendValidationFailed } = require('../utils/validationError.util');

const createMembershipSchema = z.object({
  name: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim() : val),
      z
        .string({ error: Messages.MEMBERSHIP_NAME_REQUIRED })
        .min(1, Messages.MEMBERSHIP_NAME_REQUIRED)
        .max(80, Messages.MEMBERSHIP_NAME_MAX_LENGTH),
    ),
  description: z
    .preprocess(
      (val) => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed === '' ? null : trimmed;
        }
        return val;
      },
      z
        .string()
        .max(500, Messages.MEMBERSHIP_DESCRIPTION_MAX_LENGTH)
        .nullable()
        .optional(),
    ),
});

const validateCreateMembership = (req, res, next) => {
  const result = createMembershipSchema.safeParse(req.body ?? {});
  if (!result.success) return sendValidationFailed(res, result.error);
  req.validatedBody = result.data;
  return next();
};

module.exports = {
  createMembershipSchema,
  validateCreateMembership,
};
