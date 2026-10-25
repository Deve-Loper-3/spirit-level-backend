const sendSuccess = (res, { statusCode = 200, message, data, pagination, meta }) => {
  const body = { success: true, message, data };
  if (pagination) body.pagination = pagination;
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

const sendError = (res, { statusCode, message, code, errors }) => {
  const body = { success: false, message };
  if (code) body.code = code;
  if (errors && errors.length > 0) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
