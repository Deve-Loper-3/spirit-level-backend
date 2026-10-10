const USER_AGENT_HEADER = 'user-agent';

const getRequestMeta = (req) => ({
  ipAddress: req.ip,
  userAgent: req.get(USER_AGENT_HEADER),
});

module.exports = { getRequestMeta };
