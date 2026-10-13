const sendSuccess = (res, { statusCode = 200, message, data }) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const sendError = (res, { statusCode, message, errors }) => {
  const body = { success: false, message };
  if (errors && errors.length > 0) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
