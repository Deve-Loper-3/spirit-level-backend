const { createPlan: createNewPlan } = require('../services/plan.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const createPlan = async (req, res, next) => {
  try {
    const actor = {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
    };
    const meta = getRequestMeta(req);
    const plan = await createNewPlan({
      actor,
      payload: req.body,
      meta,
    });

    res.setHeader('Location', `/api/v1/plans/${plan.id}`);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.PLAN_CREATED_SUCCESS,
      data: plan,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createPlan,
};
