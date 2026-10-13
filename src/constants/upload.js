const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;

const IMAGE_EXTENSION_BY_MIME_TYPE = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

const ALLOWED_IMAGE_MIME_TYPES = Object.freeze(Object.keys(IMAGE_EXTENSION_BY_MIME_TYPE));

const PROFILE_IMAGE_FOLDER = 'profile-images';

const UPLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

const BLOB_API_URL = 'https://vercel.com/api/blob';
const BLOB_API_VERSION = '12';
const BLOB_PUBLIC_HOST_SUFFIX = '.public.blob.vercel-storage.com';

module.exports = Object.freeze({
  MAX_IMAGE_SIZE_BYTES,
  IMAGE_EXTENSION_BY_MIME_TYPE,
  ALLOWED_IMAGE_MIME_TYPES,
  PROFILE_IMAGE_FOLDER,
  UPLOAD_TOKEN_TTL_MS,
  BLOB_API_URL,
  BLOB_API_VERSION,
  BLOB_PUBLIC_HOST_SUFFIX,
});
