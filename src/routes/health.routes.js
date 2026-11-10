const { Router } = require('express');
const prisma = require('../config/prisma');
const { publicLimiter } = require('../middlewares/rateLimiter.middleware');
const { methodNotAllowed } = require('../middlewares/methodNotAllowed.middleware');

const router = Router();

// Liveness: the process is up. Not rate limited, so load balancers and orchestrators can poll it freely.
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness: dependencies (DB) are ready. Runs a DB query, so it is rate limited per IP.
router.get('/ready', publicLimiter, async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', db: 'up' });
  } catch (error) {
    req.log.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'not_ready', db: 'down' });
  }
});

// Any other method on these paths: 405 with an Allow header (not 404).
router.all('/', methodNotAllowed(['GET']));
router.all('/ready', methodNotAllowed(['GET']));

module.exports = router;
