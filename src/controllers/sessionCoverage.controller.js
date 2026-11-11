const { listSessionCoverage: findCoverage } = require('../services/sessionCoverage.service');
const { sendSuccess } = require('../utils/apiResponse.util');

const listSessionCoverage = async (req, res, next) => {
  try {
    const { data, pagination } = await findCoverage({
      caller: { id: req.user.id, role: req.user.role },
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data, pagination });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listSessionCoverage };
