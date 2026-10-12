const {
  registerMember,
  completeMemberRegistration,
  loginWithPassword,
  refreshTokens,
  logout: logoutSession,
  getProfile,
} = require('../services/auth.service');
const {
  requestPasswordReset,
  verifyResetOtp,
  resetPassword: resetPasswordWithOtp,
} = require('../services/password-reset.service');
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

const refresh = async (req, res, next) => {
  try {
    const tokens = await refreshTokens(req.body.refreshToken, getRequestMeta(req));
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.TOKEN_REFRESH_SUCCESS,
      data: { tokens },
    });
  } catch (err) {
    return next(err);
  }
};

// Same response for every token, so it never reveals whether the token was valid.
const logout = async (req, res, next) => {
  try {
    await logoutSession(req.body.refreshToken, req.user, getRequestMeta(req));
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.LOGOUT_SUCCESS,
      data: null,
    });
  } catch (err) {
    return next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await getProfile(req.user.id);
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.PROFILE_FETCHED_SUCCESS,
      data: { user },
    });
  } catch (err) {
    return next(err);
  }
};

// Same response for every email, so it never reveals whether the account exists.
const forgotPassword = async (req, res, next) => {
  try {
    await requestPasswordReset({ email: req.body.email, meta: getRequestMeta(req) });
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.PASSWORD_RESET_OTP_REQUESTED,
      data: null,
    });
  } catch (err) {
    return next(err);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const result = await verifyResetOtp({
      email: req.body.email,
      otp: req.body.otp,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.PASSWORD_RESET_OTP_VERIFIED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    await resetPasswordWithOtp({
      email: req.body.email,
      resetToken: req.body.resetToken,
      newPassword: req.body.newPassword,
      meta: getRequestMeta(req),
    });
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.PASSWORD_RESET_SUCCESS,
      data: null,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  completeRegister,
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  verifyOtp,
  resetPassword,
};
