const z = require('zod');
const { Messages } = require('../constants/messages');
const {
  CoachType,
  CoachStatus,
  COACH_BIO_MAX_LENGTH,
  COACH_MANAGER_ROLES,
  COACH_READER_ROLES,
} = require('../constants/coach');
const { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE } = require('../constants/pagination');
const { pick } = require('../utils/pick.util');
const { staffUserFields } = require('./staff.validation');
const { trustedImageUrl } = require('./uploads.validation');
const {
  validateBody,
  validateParams,
  validateQuery,
  validateByRole,
} = require('../middlewares/validate.middleware');

const COACH_SEARCH_MAX_LENGTH = 100;

const coachTypeField = z.enum(Object.values(CoachType), { error: Messages.COACH_TYPE_INVALID });

const coachStatusField = z.enum(Object.values(CoachStatus), {
  error: Messages.COACH_STATUS_INVALID,
});

const bioField = z
  .string({ error: Messages.COACH_BIO_INVALID })
  .trim()
  .max(COACH_BIO_MAX_LENGTH, Messages.COACH_BIO_MAX_LENGTH);

const createCoachSchema = z
  .object({
    ...staffUserFields,

    coachType: coachTypeField,

    bio: bioField.optional(),

    profileImageUrl: trustedImageUrl.optional(),

    status: coachStatusField.optional(),
  })
  .strict();

// Every field a coach update can touch. bio and profileImageUrl accept null to clear them;
// phone stays required on the user, so it cannot be cleared.
const updatableFieldSchemas = {
  ...staffUserFields,
  profileImageUrl: trustedImageUrl.nullable(),
  bio: bioField.nullable(),
  coachType: coachTypeField,
};

// Partial update limited to `allowedFields`; status is never part of it (it has its own route).
const buildUpdateCoachSchema = (allowedFields) =>
  z
    .object(pick(updatableFieldSchemas, allowedFields))
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, Messages.COACH_UPDATE_EMPTY);

const coachStatusBodySchema = z.object({ status: coachStatusField }).strict();

// Query values arrive as strings, so numbers are coerced. A blank search means "no search".
const listQueryFields = {
  page: z.coerce
    .number({ error: Messages.PAGE_INVALID })
    .int(Messages.PAGE_INVALID)
    .min(1, Messages.PAGE_INVALID)
    .max(MAX_PAGE, Messages.PAGE_INVALID)
    .default(DEFAULT_PAGE),

  limit: z.coerce
    .number({ error: Messages.LIMIT_INVALID })
    .int(Messages.LIMIT_INVALID)
    .min(1, Messages.LIMIT_INVALID)
    .max(MAX_LIMIT, Messages.LIMIT_INVALID)
    .default(DEFAULT_LIMIT),

  search: z
    .string({ error: Messages.COACH_SEARCH_INVALID })
    .trim()
    .max(COACH_SEARCH_MAX_LENGTH, Messages.COACH_SEARCH_INVALID)
    .transform((value) => value || undefined)
    .optional(),
};

// Managers may also filter by status and type.
const listCoachesQuerySchema = z
  .object({
    ...listQueryFields,
    status: coachStatusField.optional(),
    coachType: coachTypeField.optional(),
  })
  .strict();

// Everyone else may only page and search; a status or type filter is rejected, not ignored.
const publicListCoachesQuerySchema = z.object(listQueryFields).strict();

const coachIdParamSchema = z.object({
  coachId: z.uuid({ error: Messages.COACH_ID_INVALID }),
});

const validateCreateCoach = validateBody(createCoachSchema);
const validateCoachIdParam = validateParams(coachIdParamSchema);

const validateListCoachesQuery = validateByRole(
  new Map(
    COACH_READER_ROLES.map((role) => [
      role,
      validateQuery(
        COACH_MANAGER_ROLES.includes(role) ? listCoachesQuerySchema : publicListCoachesQuerySchema,
      ),
    ]),
  ),
);

// `fieldsByRole` maps a role to the fields it may change (UPDATE_FIELDS_BY_ROLE); one schema per role.
const validateUpdateCoach = (fieldsByRole) =>
  validateByRole(
    new Map(
      [...fieldsByRole].map(([role, fields]) => [
        role,
        validateBody(buildUpdateCoachSchema(fields)),
      ]),
    ),
  );
const validateCoachStatusBody = validateBody(coachStatusBodySchema);

module.exports = {
  createCoachSchema,
  listCoachesQuerySchema,
  publicListCoachesQuerySchema,
  coachIdParamSchema,
  buildUpdateCoachSchema,
  coachStatusBodySchema,
  validateCreateCoach,
  validateListCoachesQuery,
  validateCoachIdParam,
  validateUpdateCoach,
  validateCoachStatusBody,
};
