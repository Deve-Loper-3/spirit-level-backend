const { createImageUploadToken } = require('../infra/storage/blob.storage');
const { updateProfileImage: updateUserProfileImage } = require('../services/uploads.service');
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

const updateProfileImage = async (req, res, next) => {
  try {
    const user = await updateUserProfileImage(req.user.id, req.body.profileImageUrl);
    return sendSuccess(res, {
      statusCode: 200,
      message: Messages.PROFILE_IMAGE_UPDATED_SUCCESS,
      data: user,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { issueProfileImageToken, updateProfileImage };
