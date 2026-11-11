const { getOpenSlots: findOpenSlots } = require('../services/coachSlots.service');
const { sendSuccess } = require('../utils/apiResponse.util');

const getOpenSlots = async (req, res, next) => {
  try {
    const data = await findOpenSlots({
      caller: { id: req.user.id, role: req.user.role },
      coachId: req.params.coachId,
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
};

module.exports = { getOpenSlots };
