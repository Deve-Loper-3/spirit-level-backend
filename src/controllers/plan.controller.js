const {
  createPlan: createNewPlan,
  listPlans: findPlans,
  getPlan: findPlan,
  updatePlan: editPlan,
  changePlanStatus: moveToStatus,
} = require('../services/plan.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { toActor } = require('../utils/actor.util');
const { Messages } = require('../constants/messages');

const createPlan = async (req, res, next) => {
  try {
    const actor = toActor(req);
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

const listPlans = async (req, res, next) => {
  try {
    const { plans, pagination, counts } = await findPlans({ query: req.validatedQuery });
    return sendSuccess(res, { data: plans, pagination, counts });
  } catch (err) {
    return next(err);
  }
};

const getPlan = async (req, res, next) => {
  try {
    const plan = await findPlan({ plan: req.plan });
    return sendSuccess(res, { data: plan });
  } catch (err) {
    return next(err);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const plan = await editPlan({
      actor: toActor(req),
      plan: req.plan,
      next: req.validatedBody,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.PLAN_UPDATED_SUCCESS, data: plan });
  } catch (err) {
    return next(err);
  }
};

const changePlanStatus = async (req, res, next) => {
  try {
    const result = await moveToStatus({
      actor: toActor(req),
      plan: req.plan,
      status: req.validatedBody.status,
      reason: req.validatedBody.reason,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, { message: Messages.PLAN_STATUS_UPDATED_SUCCESS, data: result });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  changePlanStatus,
};
