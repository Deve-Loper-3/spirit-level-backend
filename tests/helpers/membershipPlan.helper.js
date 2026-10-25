const prisma = require('../../src/config/prisma');

const deleteTestPlans = async (prefix, client = prisma) => {
  return client.membershipPlan.deleteMany({
    where: {
      name: {
        startsWith: prefix,
      },
    },
  });
};

module.exports = {
  deleteTestPlans,
};
