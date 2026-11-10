const {
  getWeeklyAvailability: findWeeklyAvailability,
  saveWeeklyAvailability: storeWeeklyAvailability,
} = require('../services/coachAvailability.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role });

const getWeeklyAvailability = async (req, res, next) => {
  try {
    const week = await findWeeklyAvailability({
      caller: toActor(req),
      coachId: req.params.coachId,
    });
    return sendSuccess(res, { data: week });
  } catch (err) {
    return next(err);
  }
};

const saveWeeklyAvailability = async (req, res, next) => {
  try {
    const week = await storeWeeklyAvailability({
      actor: toActor(req),
      coachId: req.params.coachId,
      days: req.body.days,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.COACH_AVAILABILITY_SAVED_SUCCESS, data: week });
  } catch (err) {
    return next(err);
  }
};

module.exports = { getWeeklyAvailability, saveWeeklyAvailability };
