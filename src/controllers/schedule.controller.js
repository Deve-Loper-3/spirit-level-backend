const scheduleService = require('../services/schedule.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

// Slot Controllers
const listSlots = async (req, res, next) => {
  try {
    const slots = await scheduleService.listSlots({
      classId: req.params.id,
      user: req.user,
      query: req.validatedQuery || {},
    });
    return sendSuccess(res, { data: slots });
  } catch (err) {
    return next(err);
  }
};

const createSlots = async (req, res, next) => {
  try {
    const result = await scheduleService.createSlots({
      classId: req.params.id,
      payload: req.body,
      user: req.user,
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.SLOT_CREATED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const updateSlot = async (req, res, next) => {
  try {
    const updated = await scheduleService.updateSlot({
      slotId: req.params.slotId,
      classId: req.params.id,
      payload: req.body,
      user: req.user,
    });
    return sendSuccess(res, {
      message: Messages.SLOT_UPDATED_SUCCESS,
      data: updated,
    });
  } catch (err) {
    return next(err);
  }
};

const deleteSlot = async (req, res, next) => {
  try {
    const result = await scheduleService.deleteSlot({
      slotId: req.params.slotId,
      classId: req.params.id,
      user: req.user,
    });
    return sendSuccess(res, {
      message: Messages.SLOT_DELETED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

// Session Controllers
const listSessions = async (req, res, next) => {
  try {
    const { sessions, pagination } = await scheduleService.listSessions({
      user: req.user,
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data: sessions, pagination });
  } catch (err) {
    return next(err);
  }
};

const getSession = async (req, res, next) => {
  try {
    const session = await scheduleService.getSession({
      sessionId: req.params.id,
      user: req.user,
    });
    return sendSuccess(res, { data: session });
  } catch (err) {
    return next(err);
  }
};

const createSession = async (req, res, next) => {
  try {
    const session = await scheduleService.createSession({
      payload: req.body,
      user: req.user,
    });
    res.setHeader('Location', `/api/v1/sessions/${session.id}`);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.SESSION_CREATED_SUCCESS,
      data: session,
    });
  } catch (err) {
    return next(err);
  }
};

const patchSession = async (req, res, next) => {
  try {
    const updated = await scheduleService.patchSession({
      sessionId: req.params.id,
      payload: req.body,
      user: req.user,
    });
    return sendSuccess(res, {
      message: Messages.SESSION_UPDATED_SUCCESS,
      data: updated,
    });
  } catch (err) {
    return next(err);
  }
};

const cancelSession = async (req, res, next) => {
  try {
    const result = await scheduleService.cancelSession({
      sessionId: req.params.id,
      payload: req.body,
      user: req.user,
    });
    return sendSuccess(res, {
      message: Messages.SESSION_CANCELLED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const restoreSession = async (req, res, next) => {
  try {
    const restored = await scheduleService.restoreSession({
      sessionId: req.params.id,
      user: req.user,
    });
    return sendSuccess(res, {
      message: Messages.SESSION_RESTORED_SUCCESS,
      data: restored,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listSlots,
  createSlots,
  updateSlot,
  deleteSlot,
  listSessions,
  getSession,
  createSession,
  patchSession,
  cancelSession,
  restoreSession,
};
