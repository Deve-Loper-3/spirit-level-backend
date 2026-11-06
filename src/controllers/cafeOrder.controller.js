const {
  listOrders,
  getOrder,
  getSummary,
  updateOrderStatus,
} = require('../services/cafeOrder.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

// req.user is set by `authenticate` from the DB; it is the only source of identity and role.
const listCafeOrders = async (req, res, next) => {
  try {
    const result = await listOrders({ user: req.user, query: req.validatedQuery });
    return sendSuccess(res, { data: result.data, pagination: result.pagination });
  } catch (err) {
    return next(err);
  }
};

const getCafeOrder = async (req, res, next) => {
  try {
    const order = await getOrder({ user: req.user, orderId: req.validatedParams.orderId });
    return sendSuccess(res, { data: order });
  } catch (err) {
    return next(err);
  }
};

const getCafeOrderSummary = async (req, res, next) => {
  try {
    const summary = await getSummary({ user: req.user, query: req.validatedQuery });
    return sendSuccess(res, { data: summary });
  } catch (err) {
    return next(err);
  }
};

const patchCafeOrderStatus = async (req, res, next) => {
  try {
    const order = await updateOrderStatus({
      actor: req.user,
      orderId: req.validatedParams.orderId,
      status: req.validatedBody.status,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.ORDER_STATUS_UPDATED_SUCCESS, data: order });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listCafeOrders, getCafeOrder, getCafeOrderSummary, patchCafeOrderStatus };
