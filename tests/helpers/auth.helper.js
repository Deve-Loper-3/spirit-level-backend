const { signAccessToken } = require('../../src/utils/jwt.util');

const bearerFor = (user) => `Bearer ${signAccessToken({ userId: user.id, role: user.role })}`;

module.exports = { bearerFor };
