const {
  listItems: getItemsList,
  getItemById: getItemDetails,
  createItem: createNewItem,
  updateItem: updateExistingItem,
  updateItemAvailability: updateExistingAvailability,
  updateItemVisibility: updateExistingVisibility,
} = require('../services/cafeItem.service');
const { createImageUploadToken } = require('../infra/storage/blob.storage');
const { CAFE_IMAGE_FOLDER } = require('../constants/cafe');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const listItems = async (req, res, next) => {
  try {
    const result = await getItemsList({
      query: req.validatedQuery || req.query,
      userRole: req.user.role,
    });

    return sendSuccess(res, {
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return next(err);
  }
};

const getItem = async (req, res, next) => {
  try {
    const item = await getItemDetails({
      itemId: req.params.itemId,
      userRole: req.user.role,
    });

    return sendSuccess(res, { data: item });
  } catch (err) {
    return next(err);
  }
};

const createItem = async (req, res, next) => {
  try {
    const item = await createNewItem({
      payload: req.validatedBody || req.body,
    });

    res.setHeader('Location', `/api/v1/cafe/items/${item.id}`);
    return sendSuccess(res, {
      statusCode: 201,
      message: Messages.ITEM_CREATED_SUCCESS,
      data: item,
    });
  } catch (err) {
    return next(err);
  }
};

const patchItem = async (req, res, next) => {
  try {
    const item = await updateExistingItem({
      itemId: req.params.itemId,
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.ITEM_UPDATED_SUCCESS,
      data: item,
    });
  } catch (err) {
    return next(err);
  }
};

const patchItemAvailability = async (req, res, next) => {
  try {
    const item = await updateExistingAvailability({
      itemId: req.params.itemId,
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.ITEM_AVAILABILITY_UPDATED_SUCCESS,
      data: item,
    });
  } catch (err) {
    return next(err);
  }
};

const patchItemVisibility = async (req, res, next) => {
  try {
    const item = await updateExistingVisibility({
      itemId: req.params.itemId,
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.ITEM_VISIBILITY_UPDATED_SUCCESS,
      data: item,
    });
  } catch (err) {
    return next(err);
  }
};

const issueCafeImageToken = async (req, res, next) => {
  try {
    const data = await createImageUploadToken(
      req.validatedBody.contentType,
      CAFE_IMAGE_FOLDER,
    );

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.IMAGE_UPLOAD_TOKEN_ISSUED,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listItems,
  getItem,
  createItem,
  patchItem,
  patchItemAvailability,
  patchItemVisibility,
  issueCafeImageToken,
};
