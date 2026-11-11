const {
  listEligibleCoaches: findEligibleCoaches,
} = require('../services/coachEligibility.service');
const { sendSuccess } = require('../utils/apiResponse.util');

const listEligibleCoaches = async (req, res, next) => {
  try {
    const data = await findEligibleCoaches({ query: req.validatedQuery });
    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listEligibleCoaches };
