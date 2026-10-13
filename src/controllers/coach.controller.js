const {
  listCoaches: findCoaches,
  getCoach: findCoach,
  getMyCoach: findMyCoach,
  updateCoach: updateCoachProfile,
  setCoachStatus: changeCoachStatus,
} = require('../services/coach.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role });

const listCoaches = async (req, res, next) => {
  try {
    const { coaches, pagination } = await findCoaches({
      caller: toActor(req),
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data: coaches, pagination });
  } catch (err) {
    return next(err);
  }
};

const getCoach = async (req, res, next) => {
  try {
    const coach = await findCoach({ caller: toActor(req), coachId: req.params.coachId });
    return sendSuccess(res, { data: coach });
  } catch (err) {
    return next(err);
  }
};

const getMyCoach = async (req, res, next) => {
  try {
    const coach = await findMyCoach(toActor(req));
    return sendSuccess(res, { data: coach });
  } catch (err) {
    return next(err);
  }
};

// `fieldsByRole` maps a role to the fields it may change (UPDATE_FIELDS_BY_ROLE).
const createUpdateCoachHandler = (fieldsByRole) => async (req, res, next) => {
  try {
    const coach = await updateCoachProfile({
      actor: toActor(req),
      coachId: req.params.coachId,
      changes: req.body,
      allowedFields: fieldsByRole.get(req.user.role) ?? [],
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.COACH_UPDATED_SUCCESS, data: coach });
  } catch (err) {
    return next(err);
  }
};

const setCoachStatus = async (req, res, next) => {
  try {
    const coach = await changeCoachStatus({
      actor: toActor(req),
      coachId: req.params.coachId,
      status: req.body.status,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.COACH_STATUS_UPDATED_SUCCESS, data: coach });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listCoaches, getCoach, getMyCoach, createUpdateCoachHandler, setCoachStatus };
