const {
  listCategories: getCategoriesList,
  createCategory: createNewCategory,
  updateCategory: updateExistingCategory,
  deleteCategory: deleteExistingCategory,
} = require('../services/cafeCategory.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const listCategories = async (req, res, next) => {
  try {
    const categories = await getCategoriesList({ userRole: req.user.role });
    return sendSuccess(res, { data: categories });
  } catch (err) {
    return next(err);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const category = await createNewCategory({
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.CATEGORY_CREATED_SUCCESS,
      data: category,
    });
  } catch (err) {
    return next(err);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const category = await updateExistingCategory({
      categoryId: req.params.categoryId,
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.CATEGORY_UPDATED_SUCCESS,
      data: category,
    });
  } catch (err) {
    return next(err);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    await deleteExistingCategory({
      categoryId: req.params.categoryId,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.CATEGORY_DELETED_SUCCESS,
      data: null,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
