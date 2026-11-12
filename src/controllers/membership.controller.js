const {
  createMembership: createNewMembership,
  listMemberships: findMemberships,
  getMembership: findMembership,
} = require('../services/membership.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');
const { toActor } = require('../utils/actor.util');
const { getRequestMeta } = require('../utils/requestMeta.util');

const createMembership = async (req, res, next) => {
  try {
    const membership = await createNewMembership({
      actor: toActor(req),
      payload: req.validatedBody || req.body,
      meta: getRequestMeta(req),
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

const listMemberships = async (req, res, next) => {
  try {
    const { memberships, pagination } = await findMemberships({ query: req.validatedQuery });
    return sendSuccess(res, { data: memberships, pagination });
  } catch (err) {
    return next(err);
  }
};

const getMembership = async (req, res, next) => {
  try {
    const membership = await findMembership(req.params.id);
    return sendSuccess(res, { data: membership });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createMembership,
  listMemberships,
  getMembership,
};
