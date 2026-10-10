const toPublicUser = ({
  id,
  fullName,
  email,
  phone,
  whatsappNumber,
  gender,
  birthDay,
  birthMonth,
  profileImageUrl = null,
  role,
  status,
  createdAt,
}) => ({
  id,
  fullName,
  email,
  phone,
  whatsappNumber,
  gender,
  birthDay,
  birthMonth,
  profileImageUrl,
  role,
  status,
  createdAt,
});

const toCompletedRegistration = ({ id, status, registrationCompletedAt }) => ({
  id,
  status,
  registrationCompletedAt,
});

module.exports = { toPublicUser, toCompletedRegistration };
