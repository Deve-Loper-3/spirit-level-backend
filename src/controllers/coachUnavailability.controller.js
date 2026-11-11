const service = require('../services/coachUnavailability.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role });

const listUnavailability = async (req, res, next) => {
  try {
    const { data, pagination } = await service.listUnavailability({
      caller: toActor(req),
      coachId: req.params.coachId,
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data, pagination });
  } catch (err) {
    return next(err);
  }
};

const createUnavailability = async (req, res, next) => {
  try {
    const data = await service.createUnavailability({
      actor: toActor(req),
      coachId: req.params.coachId,
      input: req.body,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.UNAVAILABILITY_CREATED_SUCCESS,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

const updateUnavailability = async (req, res, next) => {
  try {
    const data = await service.updateUnavailability({
      actor: toActor(req),
      coachId: req.params.coachId,
      unavailabilityId: req.params.unavailabilityId,
      patch: req.body,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.UNAVAILABILITY_UPDATED_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

const deleteUnavailability = async (req, res, next) => {
  try {
    const data = await service.deleteUnavailability({
      actor: toActor(req),
      coachId: req.params.coachId,
      unavailabilityId: req.params.unavailabilityId,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.UNAVAILABILITY_DELETED_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listUnavailability,
  createUnavailability,
  updateUnavailability,
  deleteUnavailability,
};
