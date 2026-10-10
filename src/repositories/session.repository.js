const crypto = require('crypto');
const prisma = require('../config/prisma');
const { AuditAction } = require('../constants/audit');
const { createAuditLog } = require('./audit-log.repository');

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

module.exports = { createLoginSessionTx };
