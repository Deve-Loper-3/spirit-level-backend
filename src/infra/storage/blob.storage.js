const crypto = require('crypto');
const { del } = require('@vercel/blob');
const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { createAppError } = require('../../errors/AppError');
const { Messages } = require('../../constants/messages');
const { AppErrors } = require('../../constants/errors');
const {
  MAX_IMAGE_SIZE_BYTES,
  IMAGE_EXTENSION_BY_MIME_TYPE,
  ALLOWED_IMAGE_MIME_TYPES,
  PROFILE_IMAGE_FOLDER,
  UPLOAD_TOKEN_TTL_MS,
  BLOB_API_URL,
  BLOB_API_VERSION,
  BLOB_PUBLIC_HOST_SUFFIX,
} = require('../../constants/upload');

// Read-write tokens look like vercel_blob_rw_<storeId>_<secret>.
const getStoreId = (token) => token?.split('_')[3];

// The server picks the pathname, so the client can never choose the folder or file name.
// Returns everything a mobile client needs to PUT the file straight to Vercel Blob.
const createImageUploadToken = async (contentType, folder = PROFILE_IMAGE_FOLDER) => {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw createAppError(AppErrors.IMAGE_UPLOAD_NOT_CONFIGURED);
  }

  const extension = IMAGE_EXTENSION_BY_MIME_TYPE[contentType];
  if (!extension) {
    throw createAppError(AppErrors.IMAGE_TYPE_NOT_ALLOWED);
  }

  const pathname = `${folder}/${crypto.randomUUID()}.${extension}`;
  const validUntil = Date.now() + UPLOAD_TOKEN_TTL_MS;

  let clientToken;
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_IMAGE_SIZE_BYTES,
      addRandomSuffix: true,
      validUntil,
    });
  } catch (err) {
    logger.error({ err }, Messages.IMAGE_UPLOAD_TOKEN_FAILED);
    throw createAppError(AppErrors.IMAGE_UPLOAD_TOKEN_FAILED);
  }

  return {
    clientToken,
    expiresAt: new Date(validUntil).toISOString(),
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    allowedContentTypes: ALLOWED_IMAGE_MIME_TYPES,
    upload: {
      method: 'PUT',
      url: `${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`,
      headers: {
        authorization: `Bearer ${clientToken}`,
        'x-api-version': BLOB_API_VERSION,
        'x-vercel-blob-access': 'public',
        'x-content-type': contentType,
        'x-add-random-suffix': '1',
      },
    },
  };
};

// Accepts only https URLs of our own public blob store under the profile image folder.
// When the token is configured the host must match our store id; otherwise any blob host is allowed.
const isTrustedImageUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!url.pathname.startsWith(`/${PROFILE_IMAGE_FOLDER}/`)) return false;

  const host = url.hostname.toLowerCase();
  const storeId = getStoreId(env.BLOB_READ_WRITE_TOKEN);
  return storeId
    ? host === `${storeId}${BLOB_PUBLIC_HOST_SUFFIX}`.toLowerCase()
    : host.endsWith(BLOB_PUBLIC_HOST_SUFFIX);
};

// Best-effort cleanup: callers must never fail because an old image could not be removed.
const deleteImage = async (url) => {
  if (!url) return;

  try {
    await del(url, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    logger.warn({ err, url }, Messages.IMAGE_DELETE_FAILED);
  }
};

module.exports = { createImageUploadToken, isTrustedImageUrl, deleteImage };
