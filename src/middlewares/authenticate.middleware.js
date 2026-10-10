const jwt = require('jsonwebtoken');
const { verifyAccessToken } = require('../utils/jwt.util');
const { findAuthById } = require('../repositories/user.repository');
const { assertCanLogin } = require('../services/login.policies');
const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { Messages } = require('../constants/messages');

const BEARER_HEADER_PATTERN = /^Bearer (\S+)$/i;

const extractBearerToken = (req) => {
  const match = BEARER_HEADER_PATTERN.exec(req.headers.authorization ?? '');
  if (!match) throw createAppError(AppErrors.UNAUTHORIZED, Messages.NO_TOKEN_PROVIDED);
  return match[1];
};

// TokenExpiredError extends JsonWebTokenError, so it must be checked first.
// Anything that is not a jsonwebtoken error is a server problem and is rethrown.
const verifyTokenOrThrow = (token) => {
  try {
    return verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw createAppError(AppErrors.TOKEN_EXPIRED);
    if (err instanceof jwt.JsonWebTokenError) throw createAppError(AppErrors.INVALID_TOKEN);
    throw err;
  }
};

// Role and status come from the DB, never from the token. An unknown user gets the same
// INVALID_TOKEN as a bad token so the response does not reveal whether the account exists.
const loadActiveUser = async (userId) => {
  const user = userId ? await findAuthById(userId) : null;
  if (!user) throw createAppError(AppErrors.INVALID_TOKEN);
  assertCanLogin(user);
  return user;
};

const authenticate = async (req, _res, next) => {
  try {
    const { sub } = verifyTokenOrThrow(extractBearerToken(req));
    const { id, role, status } = await loadActiveUser(sub);
    req.user = { id, role, status };
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { authenticate };
