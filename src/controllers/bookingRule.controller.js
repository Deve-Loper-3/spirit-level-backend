const {
  listBookingRules: findBookingRules,
  createBookingRule: addBookingRule,
  updateBookingRule: editBookingRule,
  deleteBookingRule: removeBookingRule,
} = require('../services/bookingRule.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const toActor = (req) => ({ id: req.user.id, role: req.user.role, email: req.user.email });

const listBookingRules = async (_req, res, next) => {
  try {
    return sendSuccess(res, { data: await findBookingRules() });
  } catch (err) {
    return next(err);
  }
};

const createBookingRule = async (req, res, next) => {
  try {
    const rule = await addBookingRule({
      actor: toActor(req),
      payload: req.validatedBody,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.BOOKING_RULE_CREATED_SUCCESS,
      data: rule,
    });
  } catch (err) {
    return next(err);
  }
};

const updateBookingRule = async (req, res, next) => {
  try {
    const rule = await editBookingRule({
      actor: toActor(req),
      id: req.params.id,
      changes: req.validatedBody,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.BOOKING_RULE_UPDATED_SUCCESS, data: rule });
  } catch (err) {
    return next(err);
  }
};

const deleteBookingRule = async (req, res, next) => {
  try {
    await removeBookingRule({
      actor: toActor(req),
      id: req.params.id,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.BOOKING_RULE_DELETED_SUCCESS, data: null });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listBookingRules, createBookingRule, updateBookingRule, deleteBookingRule };
