const {
  listClasses: serviceListClasses,
  getClass: serviceGetClass,
  createClass: serviceCreateClass,
  updateClass: serviceUpdateClass,
  deactivateClass: serviceDeactivateClass,
  activateClass: serviceActivateClass,
  archiveClass: serviceArchiveClass,
  updateClassEligibility: serviceUpdateClassEligibility,
} = require('../services/class.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const listClasses = async (req, res, next) => {
  try {
    const { classes, pagination } = await serviceListClasses({
      user: req.user,
      query: req.validatedQuery,
    });
    return sendSuccess(res, { data: classes, pagination });
  } catch (err) {
    return next(err);
  }
};

const getClass = async (req, res, next) => {
  try {
    const classData = await serviceGetClass({
      user: req.user,
      classRecord: req.class,
    });
    return sendSuccess(res, { data: classData });
  } catch (err) {
    return next(err);
  }
};

const createClass = async (req, res, next) => {
  try {
    const created = await serviceCreateClass({ payload: req.validatedBody });
    res.setHeader('Location', `/api/v1/classes/${created.id}`);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.CLASS_CREATED_SUCCESS,
      data: created,
    });
  } catch (err) {
    return next(err);
  }
};

const updateClass = async (req, res, next) => {
  try {
    const updated = await serviceUpdateClass({
      classRecord: req.class,
      payload: req.validatedBody,
    });
    return sendSuccess(res, {
      message: Messages.CLASS_UPDATED_SUCCESS,
      data: updated,
    });
  } catch (err) {
    return next(err);
  }
};

const deactivateClass = async (req, res, next) => {
  try {
    const result = await serviceDeactivateClass({ classRecord: req.class });
    return sendSuccess(res, {
      message: Messages.CLASS_DEACTIVATED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const activateClass = async (req, res, next) => {
  try {
    const result = await serviceActivateClass({ classRecord: req.class });
    return sendSuccess(res, {
      message: Messages.CLASS_ACTIVATED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const archiveClass = async (req, res, next) => {
  try {
    const result = await serviceArchiveClass({ classRecord: req.class });
    return sendSuccess(res, {
      message: Messages.CLASS_ARCHIVED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

const updateEligibility = async (req, res, next) => {
  try {
    const result = await serviceUpdateClassEligibility({
      classRecord: req.class,
      planIds: req.validatedBody.planIds,
    });
    return sendSuccess(res, {
      message: Messages.CLASS_ELIGIBILITY_UPDATED_SUCCESS,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listClasses,
  getClass,
  createClass,
  updateClass,
  deactivateClass,
  activateClass,
  archiveClass,
  updateEligibility,
};
