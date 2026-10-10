const z = require('zod');
const { Messages } = require('../constants/messages');
const { ALLOWED_IMAGE_MIME_TYPES } = require('../constants/upload');

const profileImageTokenSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_MIME_TYPES, { error: Messages.IMAGE_TYPE_NOT_ALLOWED }),
});

module.exports = { profileImageTokenSchema };
