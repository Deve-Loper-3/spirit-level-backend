const { createImageUploadToken } = require('../infra/storage/blob.storage');
const { sendSuccess } = require('../utils/apiResponse.util');
const { Messages } = require('../constants/messages');

const issueProfileImageToken = async (req, res, next) => {
  try {
    const data = await createImageUploadToken(req.body.contentType);
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.IMAGE_UPLOAD_TOKEN_ISSUED,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { issueProfileImageToken };
