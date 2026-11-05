const {
  updateStock,
  listInventory: getInventoryList,
  getSummary,
} = require('../services/cafeInventory.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const listInventory = async (req, res, next) => {
  try {
    const result = await getInventoryList({ query: req.validatedQuery || req.query });

    return sendSuccess(res, {
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return next(err);
  }
};

const getInventorySummary = async (req, res, next) => {
  try {
    const summary = await getSummary();

    return sendSuccess(res, { data: summary });
  } catch (err) {
    return next(err);
  }
};

// The service already returns the toCafeStockUpdateResponse view of the persisted row.
const patchItemStock = async (req, res, next) => {
  try {
    const item = await updateStock({
      itemId: req.params.itemId,
      payload: req.validatedBody || req.body,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.ITEM_STOCK_UPDATED_SUCCESS,
      data: item,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listInventory,
  getInventorySummary,
  patchItemStock,
};
