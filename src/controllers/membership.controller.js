const {
  createMembership: createNewMembership,
  listMemberships: findAllMemberships,
} = require('../services/membership.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const createMembership = async (req, res, next) => {
  try {
    const actor = {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
    };
    const membership = await createNewMembership({
      actor,
      payload: req.validatedBody || req.body,
    });

    res.setHeader('Location', `/api/v1/memberships/${membership.id}`);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.MEMBERSHIP_CREATED_SUCCESS,
      data: membership,
    });
  } catch (err) {
    return next(err);
  }
};

const listMemberships = async (_req, res, next) => {
  try {
    const memberships = await findAllMemberships();
    return sendSuccess(res, { data: memberships });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createMembership,
  listMemberships,
};
