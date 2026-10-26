const { createAppError } = require('../errors/AppError');
const { AppErrors } = require('../constants/errors');
const { findById } = require('../repositories/class.repository');

const loadClass = () => async (req, _res, next) => {
  try {
    const isDetail = req.method === 'GET';
    const classRecord = await findById(req.params.id, { isDetail });
    if (!classRecord) {
      return next(createAppError(AppErrors.CLASS_NOT_FOUND));
    }
    req.class = classRecord;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { loadClass };
