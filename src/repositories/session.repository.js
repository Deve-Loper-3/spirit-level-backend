const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AuditAction } = require('../constants/audit');
const { createAuditLog } = require('./audit-log.repository');

// Prisma's defaults (2 s to get a connection, 5 s to finish) are too short for the remote pooled
// database when refreshes run in parallel: they failed with "Unable to start a transaction in the
// given time". Used by `rotate` and the logout transaction.
const ROTATE_TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 10000 };

// Stores only the token HASH. meta: { ipAddress?, userAgent? }.
// All three writes commit together or not at all.
const createLoginSessionTx = ({ userId, tokenHash, expiresAt, now, meta = {} }) =>
  prisma.$transaction(async (tx) => {
    const { email } = await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
      select: { email: true },
    });

    const session = await tx.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      select: { id: true },
    });

    await createAuditLog(tx, { userId, action: AuditAction.LOGIN_SUCCESS, email, meta });

    return { sessionId: session.id };
  });

// `tokenHash` is the SHA-256 hash from token.util `hashToken`. Returns null when unknown.
// The caller checks revokedAt and expiresAt.
const findByTokenHash = (tokenHash) =>
  prisma.refreshSession.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });

// Only revokes an active session, so an earlier revokedAt is never overwritten.
// Returns true when this call revoked it, false when it was already revoked or does not exist.
const revokeById = async (id, now = new Date()) => {
  const { count } = await prisma.refreshSession.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  });
  return count === 1;
};

// Revokes every active session of the user. Returns how many were revoked.
// `client` is the prisma client or a transaction client, so a caller can join its transaction.
const revokeAllByUser = async (userId, now = new Date(), client = prisma) => {
  const { count } = await client.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return count;
};

// Old session revoked and new one created: both commit together or not at all.
// The revoke only matches a session that is not yet revoked, so when two refreshes race with
// the same token exactly one wins. The loser changes nothing and gets null.
// newSessionData: { userId, tokenHash, expiresAt, meta? }. Returns { sessionId } or null.
// createLoginSessionTx cannot be reused: it runs its own transaction and also writes
// lastLoginAt and a LOGIN_SUCCESS audit row, which a refresh must not do.
const rotate = (oldSessionId, { userId, tokenHash, expiresAt, meta = {} }, now = new Date()) =>
  prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshSession.updateMany({
      where: { id: oldSessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count === 0) return null;

    const session = await tx.refreshSession.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      select: { id: true },
    });
    return { sessionId: session.id };
  }, ROTATE_TRANSACTION_OPTIONS);

// Logout: revokes the session of this token only if it belongs to `userId` and is still active,
// and writes the LOGOUT audit row in the same transaction (both commit or neither). The ownership
// check is in the `where`, so a foreign, unknown or already revoked token matches nothing and
// returns false without writing anything. Returns true when a session was revoked.
const revokeSessionWithLogoutAuditTx = ({ tokenHash, userId, now = new Date(), meta = {} }) =>
  prisma.$transaction(async (tx) => {
    const { count } = await tx.refreshSession.updateMany({
      where: { tokenHash, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) return false;

    const { email } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    await createAuditLog(tx, { userId, action: AuditAction.LOGOUT, email, meta });
    return true;
  }, ROTATE_TRANSACTION_OPTIONS);

// Deletes sessions that expired or were revoked more than `graceMs` ago. Active sessions and
// recently revoked ones stay (reuse detection needs the revoked rows for a while), so the grace
// must be positive. A null revokedAt never matches. Returns how many rows were deleted.
const deleteStaleSessions = async (graceMs, now = new Date()) => {
  if (!(graceMs > 0)) throw new RangeError('graceMs must be greater than 0');
  const cutoff = new Date(now.getTime() - graceMs);
  const { count } = await prisma.refreshSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return count;
};

module.exports = {
  createLoginSessionTx,
  findByTokenHash,
  revokeById,
  revokeAllByUser,
  rotate,
  revokeSessionWithLogoutAuditTx,
  deleteStaleSessions,
};
