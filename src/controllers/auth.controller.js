const { registerMember, completeMemberRegistration, loginWithPassword } = require('../services/auth.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');
const { getRequestMeta } = require('../utils/requestMeta.util');

const register = async (req, res, next) => {
  try {
    const user = await registerMember(req.body);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.REGISTER_SUCCESS,
      data: user,
    });
  } catch (err) {
    return next(err);
  }
};

const completeRegister = async (req, res, next) => {
  try {
    const result = await completeMemberRegistration(req.body);
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.REGISTRATION_COMPLETE_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await loginWithPassword(req.body, getRequestMeta(req));
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.LOGIN_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { register, completeRegister, login };
