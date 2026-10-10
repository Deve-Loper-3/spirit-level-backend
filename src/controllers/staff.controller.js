const { createStaff: createStaffAccount } = require('../services/staff.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { getRequestMeta } = require('../utils/requestMeta.util');
const { Messages } = require('../constants/messages');

const createStaff = async (req, res, next) => {
  try {
    const actor = { id: req.user.id, role: req.user.role };
    // tempPassword is deliberately left out: it is only ever delivered by email.
    const { user, emailSent } = await createStaffAccount(actor, req.body, getRequestMeta(req));
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.STAFF_CREATED_SUCCESS,
      data: { ...user, emailSent },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createStaff };
