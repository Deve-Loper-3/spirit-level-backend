const userRepository = require('../repositories/user.repository');
const { toPublicUser } = require('../repositories/user.mapper');

// The URL is already validated by the schema; old blobs are not deleted (client-supplied URLs).
const updateProfileImage = async (userId, profileImageUrl) => {
  const user = await userRepository.updateProfileImage(userId, profileImageUrl);
  return toPublicUser(user);
};

module.exports = { updateProfileImage };
