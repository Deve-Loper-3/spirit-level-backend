const service = require('../services/appointmentType.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role });

const listAppointmentTypes = async (req, res, next) => {
  try {
    const { data, pagination } = await service.listAppointmentTypes({
      caller: toActor(req),
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data, pagination });
  } catch (err) {
    return next(err);
  }
};

const createAppointmentType = async (req, res, next) => {
  try {
    const data = await service.createAppointmentType({
      actor: toActor(req),
      input: req.body,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.APPOINTMENT_TYPE_CREATED_SUCCESS,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

const updateAppointmentType = async (req, res, next) => {
  try {
    const data = await service.updateAppointmentType({
      actor: toActor(req),
      typeId: req.params.typeId,
      patch: req.body,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.APPOINTMENT_TYPE_UPDATED_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listAppointmentTypes, createAppointmentType, updateAppointmentType };
