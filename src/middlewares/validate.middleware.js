const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');

const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return next(result.error);
  req.body = result.data;
  return next();
};

const validateParams = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.params);
  if (!result.success) return next(result.error);
  req.params = result.data;
  return next();
};

// Express 5 makes req.query a read-only getter, so the parsed query goes on its own property.
const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) return next(result.error);
  req.validatedQuery = result.data;
  return next();
};

// Picks the validator for the caller's role (run after `authenticate`). A role without an
// entry is denied.
const validateByRole = (validatorsByRole) => (req, res, next) => {
  const validator = validatorsByRole.get(req.user?.role);
  if (!validator) return next(createAppError(AppErrors.FORBIDDEN));
  return validator(req, res, next);
};

module.exports = { validateBody, validateParams, validateQuery, validateByRole };
