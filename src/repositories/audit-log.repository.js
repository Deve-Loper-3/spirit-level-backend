const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AuditAction } = require('../constants/audit');

// `client` is the prisma client or a transaction client, so callers can join their own transaction.
// meta: { ipAddress?, userAgent? }. details: optional JSON (for example old and new values).
// Undefined optional fields are stored as NULL.
const createAuditLog = (
  client,
  { userId, action, reason, email, actorId, actorRole, details, meta = {} },
) =>
  client.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      action,
      reason,
      email,
      actorId,
      actorRole,
      details,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

const recordLoginFailure = ({ userId, email, reason, meta }) =>
  createAuditLog(prisma, { userId, action: AuditAction.LOGIN_FAILED, reason, email, meta });

module.exports = { createAuditLog, recordLoginFailure };
