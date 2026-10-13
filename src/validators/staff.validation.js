const z = require('zod');
const { Role } = require('../constants/roles');
const { Messages } = require('../constants/messages');
const { fullNameField, emailField, phoneField } = require('./auth.validation');
const { validateBody } = require('../middlewares/validate.middleware');

const createStaffSchema = z
  .object({
    fullName: fullNameField,

    email: emailField,

    phone: phoneField(Messages.PHONE_REQUIRED),

    role: z.enum([Role.COACH, Role.ADMIN, Role.OWNER], {
      error: Messages.STAFF_ROLE_INVALID,
    }),
  })
  .strict();

const validateCreateStaff = validateBody(createStaffSchema);

module.exports = { createStaffSchema, validateCreateStaff };
