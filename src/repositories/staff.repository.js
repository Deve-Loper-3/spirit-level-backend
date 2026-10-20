const prisma = require('../config/prisma');
const { AccountStatus } = require('../constants/status');
const { STAFF_DEFAULT_GENDER } = require('../constants/gender');

// `status` defaults to ACTIVE; coach creation passes DISABLED for an inactive coach.
const createStaffUser = (data, tx) => {
  const client = tx || prisma;
  return client.user.create({
    data: {
      ...data,
      status: data.status ?? AccountStatus.ACTIVE,
      mustChangePassword: true,
      gender: STAFF_DEFAULT_GENDER,
    },
  });
};

module.exports = { createStaffUser };
