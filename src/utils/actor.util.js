// The "who did it" columns of an audit row, taken from the authenticated caller (`req.user`).
// `authenticate` loads the email together with id and role, so no extra query is needed.
const toAuditActor = (actor) => ({
  actorId: actor?.id,
  actorRole: actor?.role,
  email: actor?.email ?? null,
});

// The plain actor object the services expect, built from `req.user`.
const toActor = (req) => ({ id: req.user.id, role: req.user.role, email: req.user.email });

module.exports = { toAuditActor, toActor };
