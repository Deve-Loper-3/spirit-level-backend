const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./config/prisma');
const { createApp } = require('./app');
const { startScheduleJob, stopScheduleJob } = require('./services/schedule.job');

const SHUTDOWN_TIMEOUT_MS = 10000;

const start = async () => {
  await prisma.$connect();
  logger.info('Database connected');

  startScheduleJob();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;

  const shutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${reason} received, shutting down gracefully`);

    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      stopScheduleJob();
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await prisma.$disconnect();
      logger.info('Shutdown complete');
      process.exit(exitCode);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
  });
};

start().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
