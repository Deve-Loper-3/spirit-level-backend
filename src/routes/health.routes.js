const { Router } = require('express');
const prisma = require('../config/prisma');

const router = Router();

// Liveness: process zinda hai
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness: dependencies (DB) ready hain
router.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', db: 'up' });
  } catch (error) {
    req.log.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'not_ready', db: 'down' });
  }
});

module.exports = router;
