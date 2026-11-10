const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { PlanStatus } = require('../constants/membershipPlan');
const { findById } = require('../repositories/membershipPlan.repository');

// Loads the plan named by :id onto req.plan. An unknown id is a 404 (a malformed one is already
// a 400 from validatePlanIdParam, which runs first). `rejectArchived` is for routes that edit the plan.
// Must run after `authenticate` and `authorize`, so only allowed callers can probe ids.
const loadPlan =
  ({ rejectArchived = false } = {}) =>
  async (req, _res, next) => {
    try {
      const plan = await findById(req.params.id);
      if (!plan) return next(createAppError(AppErrors.PLAN_NOT_FOUND));
      if (rejectArchived && plan.status === PlanStatus.ARCHIVED) {
        return next(createAppError(AppErrors.PLAN_ARCHIVED));
      }
      req.plan = plan;
      return next();
    } catch (err) {
      return next(err);
    }
  };

module.exports = { loadPlan };
