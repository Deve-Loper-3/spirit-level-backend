const service = require('../services/appointment.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role });

const listAppointments = async (req, res, next) => {
  try {
    const { data, pagination } = await service.listAppointments({
      caller: toActor(req),
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data, pagination });
  } catch (err) {
    return next(err);
  }
};

const getAppointment = async (req, res, next) => {
  try {
    const data = await service.getAppointment({
      caller: toActor(req),
      appointmentId: req.params.appointmentId,
    });
    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
};

const createAppointment = async (req, res, next) => {
  try {
    const data = await service.createAppointment({
      actor: toActor(req),
      input: req.body,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.APPOINTMENT_CREATED_SUCCESS,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

const cancelAppointment = async (req, res, next) => {
  try {
    const data = await service.cancelAppointment({
      actor: toActor(req),
      appointmentId: req.params.appointmentId,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.APPOINTMENT_CANCELLED_SUCCESS, data });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listAppointments, getAppointment, createAppointment, cancelAppointment };
