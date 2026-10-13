const z = require('zod');
const { Role } = require('../constants/roles');
const { Messages } = require('../constants/messages');
const { fullNameField, emailField, phoneField } = require('./auth.validation');
const { validateBody } = require('../middlewares/validate.middleware');

// Fields every staff-like account needs; the coach schema reuses them.
const staffUserFields = {
  fullName: fullNameField,

  email: emailField,

  phone: phoneField(Messages.PHONE_REQUIRED),
};

// COACH stays in the enum so that a coach request gets a pointer to the coach endpoint
// instead of the generic "invalid role" message.
const createStaffSchema = z
  .object({
    ...staffUserFields,

    role: z
      .enum([Role.MEMBER, Role.COACH, Role.ADMIN, Role.OWNER], {
        error: Messages.STAFF_ROLE_INVALID,
      })
      .refine((role) => role !== Role.COACH, Messages.STAFF_COACH_USE_COACH_ENDPOINT),
  })
  .strict();

const validateCreateStaff = validateBody(createStaffSchema);

module.exports = { staffUserFields, createStaffSchema, validateCreateStaff };
