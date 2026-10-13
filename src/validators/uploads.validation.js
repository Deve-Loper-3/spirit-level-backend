const z = require('zod');
const { Messages } = require('../constants/messages');
const { ALLOWED_IMAGE_MIME_TYPES } = require('../constants/upload');
const { isTrustedImageUrl } = require('../infra/storage/blob.storage');

const profileImageTokenSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_MIME_TYPES, { error: Messages.IMAGE_TYPE_NOT_ALLOWED }),
});

// Shared by register (optional) and the profile image update.
const trustedImageUrl = z
  .string({ error: Messages.IMAGE_URL_INVALID })
  .max(2048, Messages.IMAGE_URL_INVALID)
  .refine(isTrustedImageUrl, Messages.IMAGE_URL_INVALID);

// Blank string becomes null (reset to no image); the key itself must still be sent
const blankToNull = (v) => {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

const updateProfileImageSchema = z.object({
  profileImageUrl: z.preprocess(blankToNull, trustedImageUrl.nullable()),
});

module.exports = { profileImageTokenSchema, updateProfileImageSchema, trustedImageUrl };
