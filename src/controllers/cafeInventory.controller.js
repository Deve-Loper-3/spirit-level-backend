const { updateStock } = require('../services/cafeInventory.service');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

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
  patchItemStock,
};
