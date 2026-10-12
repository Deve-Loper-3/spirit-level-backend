// Pattern: Strategy — allowed target roles per caller role.
const { Role } = require('../constants/roles');

// To support a new caller role or target role, update entries here. Unlisted roles are denied.
// A Map (not a plain object) so inherited keys like "constructor" can never match a policy.
const creationPolicies = new Map([
  [Role.MEMBER, new Set([Role.MEMBER])],
  [Role.COACH, new Set([Role.COACH])],
  [Role.ADMIN, new Set([Role.ADMIN, Role.COACH, Role.MEMBER])],
  [Role.OWNER, new Set([Role.OWNER, Role.ADMIN, Role.COACH, Role.MEMBER])],
]);

const canCreate = (callerRole, targetRole) => {
  const allowed = creationPolicies.get(callerRole);
  if (!allowed) return false;
  return allowed.has(targetRole);
};

module.exports = { canCreate };
