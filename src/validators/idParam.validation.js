const z = require('zod');
const { Messages } = require('../constants/messages');
const { validateParams } = require('../middlewares/validate.middleware');

// Path ids must be UUIDs. A malformed id is a 400 (VALIDATION_ERROR), not a 404; the same rule as
// coaches and cafe. Looser than strict on purpose: other path params pass through untouched.
const uuidParams = (messagesByParam) =>
  validateParams(
    z.looseObject(
      Object.fromEntries(
        Object.entries(messagesByParam).map(([name, message]) => [
          name,
          z.uuid({ error: message }),
        ]),
      ),
    ),
  );

const validatePlanIdParam = uuidParams({ id: Messages.PLAN_ID_INVALID });
const validateMembershipIdParam = uuidParams({ id: Messages.MEMBERSHIP_ID_INVALID });
const validateClassIdParam = uuidParams({ id: Messages.CLASS_ID_INVALID });
const validateSlotIdParams = uuidParams({
  id: Messages.CLASS_ID_INVALID,
  slotId: Messages.SLOT_ID_INVALID,
});
const validateSessionIdParam = uuidParams({ id: Messages.SESSION_ID_INVALID });

module.exports = {
  validatePlanIdParam,
  validateMembershipIdParam,
  validateClassIdParam,
  validateSlotIdParams,
  validateSessionIdParam,
};
